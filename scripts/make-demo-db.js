// Genera un database DEMO con dati generici in DATA_DIR/demo-cunti.db.
// Uso manuale:
//   npm run demo:db                     → ./data/demo-cunti.db
//   DATA_DIR=./tmp/x npm run demo:db    → ./tmp/x/demo-cunti.db
// Se il file esiste già chiede conferma prima di sovrascriverlo.
// Per usarlo nell'app: copialo/rinominalo in cunti.db nella DATA_DIR dell'app.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data');
const OUT = path.join(DATA_DIR, 'demo-cunti.db');

async function confirmOverwrite() {
	if (!fs.existsSync(OUT)) return true;
	if (!process.stdin.isTTY) {
		console.error(`${OUT} esiste già: rilancia da un terminale interattivo per confermare la sovrascrittura.`);
		return false;
	}
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise((resolve) =>
		rl.question(`${OUT} esiste già. Sovrascrivere? [s/N] `, resolve)
	);
	rl.close();
	return /^s$/i.test(String(answer).trim());
}

if (!(await confirmOverwrite())) {
	console.log('Annullato.');
	process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.rmSync(OUT, { force: true });
fs.rmSync(OUT + '-wal', { force: true });
fs.rmSync(OUT + '-shm', { force: true });
const db = new Database(OUT);
db.pragma('journal_mode = WAL');

// Stesso schema di src/lib/server/db.ts
db.exec(`
CREATE TABLE instruments (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	symbol TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK(type IN ('etf','crypto')),
	isin TEXT,
	ter_pct REAL NOT NULL DEFAULT 0,
	tax_rate_pct REAL NOT NULL DEFAULT 26,
	currency TEXT NOT NULL DEFAULT 'EUR',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE brokers (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	logo BLOB,
	logo_mime TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE transactions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
	type TEXT NOT NULL CHECK(type IN ('buy','sell')),
	date TEXT NOT NULL,
	quantity REAL NOT NULL CHECK(quantity > 0),
	price REAL NOT NULL CHECK(price >= 0),
	fee REAL NOT NULL DEFAULT 0,
	notes TEXT,
	broker_id INTEGER REFERENCES brokers(id) ON DELETE SET NULL
);
CREATE INDEX idx_tx_instrument ON transactions(instrument_id, date);
CREATE TABLE prices (
	instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
	date TEXT NOT NULL,
	close REAL NOT NULL,
	PRIMARY KEY (instrument_id, date)
);
CREATE TABLE fx_rates (
	pair TEXT NOT NULL,
	date TEXT NOT NULL,
	rate REAL NOT NULL,
	PRIMARY KEY (pair, date)
);
CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`);

// PRNG deterministico: DB riproducibile
function mulberry32(a) {
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const DAYS = 730;

function day(offset) {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - offset);
	return d.toISOString().slice(0, 10);
}

function randomWalk(seed, start, driftPerDay, vol) {
	const rnd = mulberry32(seed);
	const out = [];
	let px = start;
	for (let i = DAYS; i >= 0; i--) {
		px *= 1 + driftPerDay + (rnd() - 0.5) * vol;
		out.push({ date: day(i), close: px });
	}
	return out;
}

function logoSvg(bg, letter) {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${bg}"/><text x="16" y="22" font-family="sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
	return Buffer.from(svg);
}

// Broker generici con logo SVG minimale
const insBroker = db.prepare('INSERT INTO brokers (name, logo, logo_mime) VALUES (?, ?, ?)');
const brokerBank = insBroker.run('Banca Demo', logoSvg('#3987e5', 'B'), 'image/svg+xml').lastInsertRowid;
const brokerEx = insBroker.run('Exchange Demo', logoSvg('#9085e9', 'X'), 'image/svg+xml').lastInsertRowid;

const insInst = db.prepare(
	'INSERT INTO instruments (symbol, name, type, isin, ter_pct, tax_rate_pct, currency) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const idWorld = insInst.run('DEMOW.MI', 'ETF Azionario Globale (demo)', 'etf', 'IE0000000001', 0.2, 26, 'EUR').lastInsertRowid;
const idBond = insInst.run('DEMOB.MI', 'ETF Bilanciato 80/20 (demo)', 'etf', 'IE0000000002', 0.25, 26, 'EUR').lastInsertRowid;
const idCoin = insInst.run('democoin', 'Democoin', 'crypto', null, 0, 26, 'USD').lastInsertRowid;

const prices = {
	[idWorld]: randomWalk(1, 78, 0.00045, 0.014),
	[idBond]: randomWalk(2, 27, 0.0003, 0.009),
	[idCoin]: randomWalk(3, 36000, 0.001, 0.05) // in USD
};
// Cambio EURUSD sintetico intorno a 1,08
const fx = randomWalk(4, 1.08, 0, 0.004);

const priceOn = (id, date) => {
	let last = prices[id][0].close;
	for (const p of prices[id]) {
		if (p.date > date) break;
		last = p.close;
	}
	return last;
};

db.transaction(() => {
	const insPx = db.prepare('INSERT INTO prices (instrument_id, date, close) VALUES (?, ?, ?)');
	for (const [id, rows] of Object.entries(prices))
		for (const r of rows) insPx.run(id, r.date, r.close);

	const insFx = db.prepare("INSERT INTO fx_rates (pair, date, rate) VALUES ('EURUSD', ?, ?)");
	for (const r of fx) insFx.run(r.date, r.close);

	const insTx = db.prepare(
		'INSERT INTO transactions (instrument_id, type, date, quantity, price, fee, notes, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	);
	// PAC mensile: 18 rate su due ETF, via banca
	for (let m = 18; m >= 1; m--) {
		const d = day(m * 30);
		insTx.run(idWorld, 'buy', d, 3, priceOn(idWorld, d), 4.9, 'PAC mensile', brokerBank);
		insTx.run(idBond, 'buy', d, 6, priceOn(idBond, d), 4.9, 'PAC mensile', brokerBank);
	}
	// crypto (in USD): acquisti sparsi + una vendita, via exchange
	for (const m of [17, 13, 9, 5]) {
		const d = day(m * 30);
		insTx.run(idCoin, 'buy', d, 0.01, priceOn(idCoin, d), 6, 'DCA', brokerEx);
	}
	const sellDay = day(60);
	insTx.run(idCoin, 'sell', sellDay, 0.015, priceOn(idCoin, sellDay), 8, 'presa di profitto', brokerEx);
})();

db.close();
console.log(`Database demo creato: ${OUT}`);
console.log('Per usarlo: copialo come cunti.db nella DATA_DIR dell\'app.');
