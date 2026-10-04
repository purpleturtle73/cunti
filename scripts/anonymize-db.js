// Anonimizza un database Cunti per lo sviluppo locale: i dati veri restano nel
// container, qui serve una copia realistica ma senza informazioni personali.
//
// Uso:
//   npm run anonymize                      → ./data/cunti.db
//   DATA_DIR=./tmp/x npm run anonymize     → ./tmp/x/cunti.db
//   aggiungi -- --yes per saltare la conferma, -- --seed=42 per un altro rimescolamento
//
// Cosa fa (in place, dopo una copia di sicurezza in ./tmp/anonimizzazione/):
// - spese: descrizioni sostituite da esercenti finti coerenti con la categoria, date
//   intatte. Importi: fattore globale netto (tenore di spesa), per anno (andamento),
//   per categoria (proporzioni) e ±20% per voce: né i totali né i movimenti sono veri. Per ogni categoria vengono definite keyword che
//   riconoscono i suoi esercenti finti, così regole, ricategorizzazione e conflitti
//   restano provabili; il 3% delle voci riceve l'esercente di un'altra categoria (fa da
//   conflitto) e parte delle voci senza categoria riceve un esercente riconoscibile.
// - card: le cifre diventano cifre finte, i suffissi personali dei bancomat lettere.
// - categorie con nomi propri (stipendio_xxx…): rinominate stipendio_a, stipendio_b…
// - broker: rinominati "Broker A"…, loghi tolti (rivelerebbero il broker).
// - transazioni: quantità scalate con lo stesso fattore globale e ±20%, note tolte. Strumenti e prezzi sono
//   pubblici e restano (servono all'aggiornamento prezzi).
// - alla fine VACUUM con secure_delete: le stringhe originali non restano nelle pagine
//   libere del file.
//
// Non tocca i backup né altri file: lo script elenca quelli che contengono ancora dati.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const YES = args.includes('--yes');
const SEED = Number(args.find((a) => a.startsWith('--seed='))?.split('=')[1] ?? 20261006);

const DATA_DIR = path.resolve(process.env.DATA_DIR ?? 'data');
const DB_PATH = path.join(DATA_DIR, 'cunti.db');

if (DATA_DIR === '/data') {
	console.error('DATA_DIR=/data è il percorso del container: questo script è solo per le copie locali.');
	process.exit(1);
}
if (!fs.existsSync(DB_PATH)) {
	console.error(`${DB_PATH} non esiste.`);
	process.exit(1);
}

async function confirm() {
	if (YES) return true;
	if (!process.stdin.isTTY) {
		console.error('Conferma necessaria: rilancia da un terminale interattivo o aggiungi --yes.');
		return false;
	}
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise((resolve) =>
		rl.question(`Anonimizzare IN PLACE ${DB_PATH}? Prima viene fatta una copia in ./tmp. [s/N] `, resolve)
	);
	rl.close();
	return /^s$/i.test(String(answer).trim());
}

if (!(await confirm())) {
	console.log('Annullato.');
	process.exit(1);
}

// ---------------------------------------------------------------- PRNG deterministico

function mulberry32(a) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);
const digits = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');

// ---------------------------------------------------------------- copia di sicurezza

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const SAFE_DIR = path.resolve('tmp', 'anonimizzazione');
fs.mkdirSync(SAFE_DIR, { recursive: true });
const SAFE = path.join(SAFE_DIR, `cunti-originale-${stamp}.db`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
await db.backup(SAFE);
console.log(`Copia di sicurezza: ${path.relative(process.cwd(), SAFE)} (contiene i dati VERI)`);

db.pragma('foreign_keys = ON');
db.pragma('secure_delete = ON');

// Schema minimo necessario (come src/lib/server/db.ts): il DB potrebbe venire da una
// versione dell'app precedente alle categorie su database.
db.exec(`
CREATE TABLE IF NOT EXISTS expense_categories (
	name TEXT PRIMARY KEY, icon TEXT, color TEXT,
	transfer INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS expense_keywords (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	category TEXT NOT NULL REFERENCES expense_categories(name) ON DELETE CASCADE ON UPDATE CASCADE,
	keyword TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kw_unique ON expense_keywords(keyword COLLATE NOCASE);
`);
const expCols = db.pragma('table_info(expenses)').map((c) => c.name);
if (expCols.length > 0 && !expCols.includes('category_manual'))
	db.exec('ALTER TABLE expenses ADD COLUMN category_manual INTEGER NOT NULL DEFAULT 0');
const hasExpenses = expCols.length > 0;

// ---------------------------------------------------------------- esercenti finti

// Famiglie riconosciute dal nome della categoria. Ogni famiglia va a una sola categoria
// (la più usata): le keyword devono essere univoche. Le altre ricevono esercenti
// sintetici derivati dal proprio nome.
const FAMILIES = [
	{ re: /supermerc|spesa|aliment/, merchants: ['ESSELUNGA', 'CONAD', 'COOP', 'CARREFOUR', 'LIDL', 'EUROSPIN', 'DESPAR'] },
	{ re: /ristor|bar|food|mangiar/, merchants: ['RISTORANTE DA GINO', 'PIZZERIA BELLA NAPOLI', 'BAR CENTRALE', 'TRATTORIA LA PERGOLA', 'SUSHI ZEN', 'DELIVEROO'] },
	{ re: /viagg|vacanz|travel/, merchants: ['BOOKING.COM', 'AIRBNB', 'RYANAIR', 'EASYJET', 'HOTEL MIRAMARE', 'ITA AIRWAYS'] },
	{ re: /traspor/, merchants: ['TRENITALIA', 'ATM MILANO', 'ITALO TRENO', 'TAXI BLU', 'UBER', 'TELEPASS'] },
	{ re: /auto|carbur|benzin/, merchants: ['ENI STATION', 'TAMOIL', 'OFFICINA ROSSI', 'GOMMISTA BIANCHI', 'AUTOSTRADE PER L ITALIA'] },
	{ re: /casa|mutuo|affitt|condomin/, merchants: ['IKEA', 'LEROY MERLIN', 'CONDOMINIO VIA VERDI', 'BRICOCENTER', 'RATA MUTUO'] },
	{ re: /bollet|utenz|energ/, merchants: ['ENEL ENERGIA', 'A2A ENERGIA', 'HERA COMM', 'VODAFONE', 'ILIAD', 'FASTWEB'] },
	{ re: /salut|benes|medic|farmac/, merchants: ['FARMACIA CENTRALE', 'STUDIO DENTISTICO', 'PALESTRA FIT', 'OTTICA VISTA'] },
	{ re: /abbigl|vestit/, merchants: ['ZARA', 'H&M', 'OVS', 'BENETTON'] },
	{ re: /acquist|web|shopp/, merchants: ['AMAZON', 'ZALANDO', 'EBAY', 'ALIEXPRESS'] },
	{ re: /cloud/, merchants: ['GOOGLE STORAGE', 'ICLOUD', 'DROPBOX', 'ONEDRIVE'] },
	{ re: /digital|abbonam|stream/, merchants: ['NETFLIX', 'SPOTIFY', 'DISNEY PLUS', 'DAZN'] },
	{ re: /banc|commiss|tass/, merchants: ['COMMISSIONI BONIFICO', 'CANONE CONTO', 'IMPOSTA DI BOLLO'] },
	{ re: /rimbors|cashback/, merchants: ['RIMBORSO SPESE', 'CASHBACK'] },
	{ re: /contant|cash|preliev/, merchants: ['PRELIEVO BANCOMAT', 'PRELEVAMENTO CONTANTI'] },
	{ re: /credito/, merchants: ['SALDO CARTA DI CREDITO'] },
	{ re: /invest|titoli/, merchants: ['GIROCONTO DEPOSITO TITOLI', 'ACQUISTO FONDI'] },
	{ re: /ignore|giro/, merchants: ['GIROCONTO INTERNO'] },
	{ re: /tabacc/, merchants: ['TABACCHERIA N 12', 'EDICOLA TABACCHI'] },
	{ re: /regal|gift/, merchants: ['LIBRERIA FELTRINELLI', 'FIORAIO PRIMAVERA'] }
];
const EMPLOYERS = ['ACME SRL', 'BETA SPA', 'GAMMA SNC', 'DELTA SRL'];
const CITIES = ['MILANO', 'ROMA', 'TORINO', 'BOLOGNA', 'FIRENZE', 'NAPOLI', 'VERONA'];
const OUT_PREFIX = ['PAGAMENTO POS', 'PAGAMENTO CARTA', 'ADDEBITO', 'ACQUISTO'];
const IN_PREFIX = ['BONIFICO DA', 'ACCREDITO'];
const UNKNOWN_DESC = ['PAGAMENTO POS ESERCENTE', 'ADDEBITO SDD', 'OPERAZIONE CARTA', 'BONIFICO DISPOSTO'];

// ---------------------------------------------------------------- categorie

const PERSONAL_CAT = /^(stipendi?o?|pensione|entrat[ae]|bonifico)_(.+)$/i;
const report = { categories: [], cards: [], brokers: [] };

const catCounts = hasExpenses
	? db.prepare('SELECT category, COUNT(*) AS n FROM expenses GROUP BY category ORDER BY n DESC').all()
	: [];

// 1) rinomina delle categorie con nomi propri
const catRename = new Map();
let letter = 0;
for (const { category } of [...catCounts].sort((a, b) => a.category.localeCompare(b.category))) {
	const m = PERSONAL_CAT.exec(category);
	if (m) catRename.set(category, `${m[1].toLowerCase()}_${String.fromCharCode(97 + letter++)}`);
}
const renameCat = db.transaction(() => {
	for (const [from, to] of catRename) {
		db.prepare('UPDATE expenses SET category = ? WHERE category = ?').run(to, from);
		db.prepare('UPDATE expense_categories SET name = ? WHERE name = ?').run(to, from);
		report.categories.push(`${from} → ${to}`);
	}
});
renameCat();

// 2) esercenti per categoria
const currentCats = hasExpenses
	? db.prepare("SELECT category, COUNT(*) AS n FROM expenses WHERE category != 'unknown' GROUP BY category ORDER BY n DESC").all()
	: [];
const usedFamilies = new Set();
const pools = new Map(); // categoria → { merchants, income }
let employer = 0;
for (const { category } of currentCats) {
	if (/^stipendi?o?_|^pensione/i.test(category) || /stipend/.test(category)) {
		pools.set(category, { merchants: [`STIPENDIO ${EMPLOYERS[employer++ % EMPLOYERS.length]}`], income: true });
		continue;
	}
	const fam = FAMILIES.findIndex((f, i) => !usedFamilies.has(i) && f.re.test(category.toLowerCase()));
	if (fam >= 0) {
		usedFamilies.add(fam);
		pools.set(category, { merchants: FAMILIES[fam].merchants, income: /rimbors|cashback/.test(category) });
	} else {
		// esercenti sintetici: "NEGOZIO <CATEGORIA> 1..3", univoci per costruzione
		const base = category.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
		pools.set(category, { merchants: [1, 2, 3].map((n) => `NEGOZIO ${base} ${n}`), income: false });
	}
}

function fakeDescription(merchant, income) {
	return income
		? `${pick(IN_PREFIX)} ${merchant} RIF ${digits(8)}`
		: `${pick(OUT_PREFIX)} ${merchant} ${pick(CITIES)} ${digits(4)}`;
}

// 3) categorie definite + keyword che riconoscono gli esercenti finti
let meta = {};
try {
	meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'categories-meta.json'), 'utf8'));
} catch {
	/* nessun meta */
}
const seedCats = db.transaction(() => {
	let pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM expense_categories').get().p;
	const insCat = db.prepare('INSERT OR IGNORE INTO expense_categories (name, icon, color, transfer, position) VALUES (?, ?, ?, ?, ?)');
	const insKw = db.prepare('INSERT OR IGNORE INTO expense_keywords (category, keyword) VALUES (?, ?)');
	const hasKw = db.prepare('SELECT 1 FROM expense_keywords WHERE category = ? LIMIT 1');
	for (const [category, pool] of pools) {
		const original = [...catRename.entries()].find(([, to]) => to === category)?.[0] ?? category;
		const m = meta[original] ?? {};
		insCat.run(category, m.icon ?? null, m.color ?? null, m.transfer ? 1 : 0, pos++);
		if (!hasKw.get(category)) for (const merchant of pool.merchants) insKw.run(category, merchant.toLowerCase());
	}
});
seedCats();
// le categorie ora vivono nel DB: l'app non deve rimigrare i vecchi json sopra di esse
db.prepare("INSERT INTO settings (key, value) VALUES ('categories_source', 'db') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();

// ---------------------------------------------------------------- spese

// Importi: il solo ±20% per voce si compensa su migliaia di righe e lascerebbe i totali
// (annui, per categoria, lo stipendio) praticamente veri. Quindi quattro livelli: un
// fattore globale netto che sposta il tenore di spesa, uno per anno che altera
// l'andamento, uno per categoria che altera le proporzioni, e il rumore per voce che
// rende irriconoscibili i singoli movimenti.
const GLOBAL_SCALE = rnd() < 0.5 ? between(0.45, 0.75) : between(1.3, 1.8);
const memo = (lo, hi) => {
	const m = new Map();
	return (key) => {
		if (!m.has(key)) m.set(key, between(lo, hi));
		return m.get(key);
	};
};
const scaleOf = memo(0.75, 1.25); // per categoria
const yearScaleOf = memo(0.85, 1.15); // per anno

if (hasExpenses) {
	const rows = db.prepare('SELECT id, date, amount, category FROM expenses').all();
	const allPools = [...pools.entries()];
	const upd = db.prepare('UPDATE expenses SET description = ?, amount = ? WHERE id = ?');
	let crossed = 0;
	let recognizableUnknown = 0;
	db.transaction(() => {
		for (const r of rows) {
			const factor = GLOBAL_SCALE * yearScaleOf(r.date.slice(0, 4)) * scaleOf(r.category) * between(0.8, 1.2);
			const amount = Math.round(r.amount * factor * 100) / 100 || (r.amount < 0 ? -0.01 : 0.01);
			let description;
			if (r.category === 'unknown') {
				// 15% riconoscibile dalle regole: dà lavoro alla ricategorizzazione
				if (allPools.length > 0 && rnd() < 0.15) {
					const [, pool] = pick(allPools);
					description = fakeDescription(pick(pool.merchants), pool.income);
					recognizableUnknown++;
				} else description = `${pick(UNKNOWN_DESC)} ${digits(6)}`;
			} else {
				let pool = pools.get(r.category);
				// 3% con l'esercente di un'altra categoria: simula una scelta manuale e
				// popola la pagina dei conflitti
				if (allPools.length > 1 && rnd() < 0.03) {
					const other = allPools.filter(([c]) => c !== r.category);
					pool = pick(other)[1];
					crossed++;
				}
				description = fakeDescription(pick(pool.merchants), pool.income && amount > 0);
			}
			upd.run(description, amount, r.id);
		}
	})();
	console.log(`Spese: ${rows.length} descrizioni e importi sostituiti (${crossed} come conflitto, ${recognizableUnknown} unknown riconoscibili).`);
}

// ---------------------------------------------------------------- card

function fakeCard(value) {
	let v = value.replace(/\d+/g, (d) => digits(d.length));
	const m = /^(bancomat)(.*)$/i.exec(v);
	if (m) {
		// suffisso personale (iniziali, nome): lettere sostituite, punteggiatura tenuta
		v = m[1] + m[2].replace(/[A-Za-zÀ-ÿ]+/, (w) => (w.length > 1 ? cardName(w) : cardName(w).charAt(0)));
	}
	return v;
}
const cardNames = new Map();
function cardName(w) {
	const key = w.charAt(0).toUpperCase();
	if (!cardNames.has(key)) cardNames.set(key, ['Alfa', 'Beta', 'Gamma', 'Delta', 'Epsilon'][cardNames.size % 5]);
	const n = cardNames.get(key);
	return w.charAt(0) === w.charAt(0).toLowerCase() ? n.toLowerCase() : n;
}
if (hasExpenses) {
	const values = db.prepare('SELECT DISTINCT card FROM expenses').all().map((r) => r.card);
	const cardNameRows = db.prepare('SELECT name FROM cards').all().map((r) => r.name);
	const mapping = new Map();
	for (const v of new Set([...values, ...cardNameRows])) mapping.set(v, fakeCard(v));
	db.transaction(() => {
		for (const [from, to] of mapping) {
			if (from === to) continue;
			db.prepare('UPDATE expenses SET card = ? WHERE card = ?').run(to, from);
			db.prepare('UPDATE OR IGNORE cards SET name = ? WHERE name = ?').run(to, from);
			report.cards.push(`${from} → ${to}`);
		}
	})();
}

// ---------------------------------------------------------------- broker e transazioni

const brokers = db.prepare('SELECT id, name FROM brokers ORDER BY id').all();
db.transaction(() => {
	brokers.forEach((b, i) => {
		const to = `Broker ${String.fromCharCode(65 + i)}`;
		db.prepare('UPDATE brokers SET name = ?, logo = NULL, logo_mime = NULL WHERE id = ?').run(to, b.id);
		report.brokers.push(`${b.name} → ${to}`);
	});
	const txs = db.prepare('SELECT id, quantity FROM transactions').all();
	const upd = db.prepare('UPDATE transactions SET quantity = ?, notes = NULL WHERE id = ?');
	for (const t of txs)
		upd.run(Math.max(1e-6, Math.round(t.quantity * GLOBAL_SCALE * between(0.8, 1.2) * 1e6) / 1e6), t.id);
	console.log(`Transazioni: ${txs.length} quantità variate, note tolte.`);
})();

// ---------------------------------------------------------------- pulizia del file

db.pragma('wal_checkpoint(TRUNCATE)');
db.exec('VACUUM');
db.close();
for (const ext of ['-wal', '-shm']) fs.rmSync(DB_PATH + ext, { force: true });

// ---------------------------------------------------------------- resoconto

const show = (title, list) => {
	console.log(`\n${title}:`);
	for (const l of list.length ? list : ['(nessuna)']) console.log(`  ${l}`);
};
show('Categorie rinominate', report.categories);
show('Card', report.cards);
show('Broker', report.brokers);

const check = new Database(DB_PATH, { readonly: true });
if (hasExpenses) {
	console.log('\nControlla che qui sotto non resti nulla di personale:');
	console.log('  categorie:', check.prepare('SELECT DISTINCT category FROM expenses ORDER BY category').all().map((r) => r.category).join(', '));
	console.log('  card:     ', check.prepare('SELECT DISTINCT card FROM expenses ORDER BY card').all().map((r) => r.card).join(', '));
}
check.close();

const others = [];
for (const dir of [DATA_DIR, path.join(DATA_DIR, 'backups')]) {
	if (!fs.existsSync(dir)) continue;
	for (const f of fs.readdirSync(dir)) {
		const full = path.join(dir, f);
		if (full !== DB_PATH && /\.db$/.test(f)) others.push(path.relative(process.cwd(), full));
	}
}
if (others.length) {
	console.log('\nAttenzione: questi file NON sono stati toccati e possono contenere dati veri:');
	for (const o of others) console.log(`  ${o}`);
}
console.log(`\nLa copia con i dati veri è in ${path.relative(process.cwd(), SAFE)}: eliminala quando hai verificato.`);
