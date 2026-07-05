// Popola il DB con dati DEMO (strumenti, transazioni e prezzi sintetici).
// Solo per provare l'interfaccia: usa un DATA_DIR dedicato, es.
//   DATA_DIR=./data-demo npm run seed:demo
//   DATA_DIR=./data-demo npm run dev
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'cunti.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS instruments (
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
CREATE TABLE IF NOT EXISTS transactions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
	type TEXT NOT NULL CHECK(type IN ('buy','sell')),
	date TEXT NOT NULL,
	quantity REAL NOT NULL CHECK(quantity > 0),
	price REAL NOT NULL CHECK(price >= 0),
	fee REAL NOT NULL DEFAULT 0,
	notes TEXT
);
CREATE TABLE IF NOT EXISTS prices (
	instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
	date TEXT NOT NULL,
	close REAL NOT NULL,
	PRIMARY KEY (instrument_id, date)
);
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
`);

// PRNG deterministico per prezzi riproducibili
function mulberry32(a) {
	return function () {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function day(offset) {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - offset);
	return d.toISOString().slice(0, 10);
}

const DAYS = 730;

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

const insInst = db.prepare(
	'INSERT OR IGNORE INTO instruments (symbol, name, type, isin, ter_pct, tax_rate_pct) VALUES (?, ?, ?, ?, ?, ?)'
);
insInst.run('SWDA.MI', 'iShares Core MSCI World', 'etf', 'IE00B4L5Y983', 0.2, 26);
insInst.run('VNGA80.MI', 'Vanguard LifeStrategy 80', 'etf', 'IE00BMVB5Q68', 0.25, 26);
insInst.run('bitcoin', 'Bitcoin', 'crypto', null, 0, 26);

const ids = Object.fromEntries(
	db.prepare('SELECT id, symbol FROM instruments').all().map((r) => [r.symbol, r.id])
);

const prices = {
	'SWDA.MI': randomWalk(1, 78, 0.00045, 0.014),
	'VNGA80.MI': randomWalk(2, 27, 0.0003, 0.009),
	bitcoin: randomWalk(3, 34000, 0.001, 0.05)
};

const insPx = db.prepare(
	'INSERT INTO prices (instrument_id, date, close) VALUES (?, ?, ?) ON CONFLICT(instrument_id, date) DO UPDATE SET close = excluded.close'
);
const priceOn = (symbol, date) => {
	const arr = prices[symbol];
	let last = arr[0].close;
	for (const p of arr) {
		if (p.date > date) break;
		last = p.close;
	}
	return last;
};

db.transaction(() => {
	for (const [symbol, rows] of Object.entries(prices))
		for (const r of rows) insPx.run(ids[symbol], r.date, r.close);

	const insTx = db.prepare(
		'INSERT INTO transactions (instrument_id, type, date, quantity, price, fee, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
	);
	if (db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n > 0) return;

	// PAC mensile: 18 rate su due ETF
	for (let m = 18; m >= 1; m--) {
		const d = day(m * 30);
		insTx.run(ids['SWDA.MI'], 'buy', d, 3, priceOn('SWDA.MI', d), 4.9, 'PAC mensile');
		insTx.run(ids['VNGA80.MI'], 'buy', d, 6, priceOn('VNGA80.MI', d), 4.9, 'PAC mensile');
	}
	// crypto: acquisti sparsi + una vendita (per testare plusvalenze realizzate)
	for (const m of [17, 13, 9, 5]) {
		const d = day(m * 30);
		insTx.run(ids['bitcoin'], 'buy', d, 0.01, priceOn('bitcoin', d), 6, 'DCA BTC');
	}
	const sellDay = day(60);
	insTx.run(ids['bitcoin'], 'sell', sellDay, 0.015, priceOn('bitcoin', sellDay), 8, 'presa di profitto');
})();

console.log('Dati demo inseriti in', path.join(DATA_DIR, 'cunti.db'));
