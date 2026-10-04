import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'cunti.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
CREATE INDEX IF NOT EXISTS idx_tx_instrument ON transactions(instrument_id, date);

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

CREATE TABLE IF NOT EXISTS brokers (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	logo BLOB,
	logo_mime TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fx_rates (
	pair TEXT NOT NULL,
	date TEXT NOT NULL,
	rate REAL NOT NULL,
	PRIMARY KEY (pair, date)
);

CREATE TABLE IF NOT EXISTS cards (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	logo BLOB,
	logo_mime TEXT,
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	date TEXT NOT NULL,
	description TEXT NOT NULL,
	card TEXT NOT NULL DEFAULT 'conto',
	amount REAL NOT NULL,
	category TEXT NOT NULL DEFAULT 'unknown'
);
CREATE INDEX IF NOT EXISTS idx_exp_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_exp_category ON expenses(category, date);
CREATE INDEX IF NOT EXISTS idx_exp_card ON expenses(card, date);

-- Categorie spese gestite dalla UI. Il campo expenses.category resta testo libero
-- (nessuna FK): una spesa può avere una categoria non (ancora) definita qui, che la
-- pagina categorie mostra come "non definita".
CREATE TABLE IF NOT EXISTS expense_categories (
	name TEXT PRIMARY KEY,
	icon TEXT,
	color TEXT,
	transfer INTEGER NOT NULL DEFAULT 0, -- giroconto/doppio conteggio: escluso dai totali
	position INTEGER NOT NULL DEFAULT 0  -- ordine: spareggio tra keyword di pari lunghezza
);

CREATE TABLE IF NOT EXISTS expense_keywords (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	category TEXT NOT NULL REFERENCES expense_categories(name) ON DELETE CASCADE ON UPDATE CASCADE,
	keyword TEXT NOT NULL
);
-- una keyword appartiene a una sola categoria: due categorie con la stessa keyword
-- renderebbero il match ambiguo
CREATE UNIQUE INDEX IF NOT EXISTS idx_kw_unique ON expense_keywords(keyword COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_kw_category ON expense_keywords(category);
`);

// Migrazione: flag "categoria impostata a mano" sulle spese. Le voci bloccate non
// vengono mai ricategorizzate dalle regole e non compaiono tra i conflitti da rivedere.
const expCols = (db.pragma('table_info(expenses)') as { name: string }[]).map((c) => c.name);
if (!expCols.includes('category_manual'))
	db.exec('ALTER TABLE expenses ADD COLUMN category_manual INTEGER NOT NULL DEFAULT 0');

// Migrazione: broker_id su transactions (DB creati prima dei broker)
const txCols = (db.pragma('table_info(transactions)') as { name: string }[]).map((c) => c.name);
if (!txCols.includes('broker_id'))
	db.exec('ALTER TABLE transactions ADD COLUMN broker_id INTEGER REFERENCES brokers(id) ON DELETE SET NULL');

export interface Instrument {
	id: number;
	symbol: string;
	name: string;
	type: 'etf' | 'crypto';
	isin: string | null;
	ter_pct: number;
	tax_rate_pct: number;
	currency: string;
}

export interface Transaction {
	id: number;
	instrument_id: number;
	type: 'buy' | 'sell';
	date: string;
	quantity: number;
	price: number;
	fee: number;
	notes: string | null;
	broker_id: number | null;
}

export interface Broker {
	id: number;
	name: string;
	logo_mime: string | null;
	has_logo: 0 | 1;
}

export interface Expense {
	id: number;
	date: string; // YYYY-MM-DD
	description: string;
	card: string;
	amount: number; // firmato: <0 uscita, >0 entrata
	category: string;
	category_manual: 0 | 1; // 1 = scelta manuale, le regole non la toccano
}

export function getSetting(key: string): string | null {
	const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
		| { value: string }
		| undefined;
	return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
	db.prepare(
		'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	).run(key, value);
}

export function allInstruments(): Instrument[] {
	return db.prepare('SELECT * FROM instruments ORDER BY name').all() as Instrument[];
}

export function allTransactions(): Transaction[] {
	return db.prepare('SELECT * FROM transactions ORDER BY date, id').all() as Transaction[];
}

export type NewTransaction = Omit<Transaction, 'id'>;

/** Inserisce solo le transazioni non già presenti nel DB.
 *  Chiave di duplicato: strumento + tipo + data + quantità + prezzo + commissioni
 *  (note e broker esclusi di proposito: la stessa operazione annotata diversamente resta un doppione).
 *  Il controllo avviene dentro la transazione SQLite, quindi vengono scartati anche i doppioni interni al batch. */
export function insertTransactionsDedup<T extends NewTransaction>(
	rows: T[]
): { inserted: T[]; duplicates: T[] } {
	const exists = db.prepare(
		'SELECT 1 FROM transactions WHERE instrument_id = ? AND type = ? AND date = ? AND quantity = ? AND price = ? AND fee = ?'
	);
	const insert = db.prepare(
		'INSERT INTO transactions (instrument_id, type, date, quantity, price, fee, notes, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	);
	const inserted: T[] = [];
	const duplicates: T[] = [];
	db.transaction(() => {
		for (const r of rows) {
			if (exists.get(r.instrument_id, r.type, r.date, r.quantity, r.price, r.fee)) {
				duplicates.push(r);
			} else {
				insert.run(r.instrument_id, r.type, r.date, r.quantity, r.price, r.fee, r.notes, r.broker_id);
				inserted.push(r);
			}
		}
	})();
	return { inserted, duplicates };
}

/** Price map per instrument: date (YYYY-MM-DD) -> close. */
export function priceHistory(instrumentId: number): Map<string, number> {
	const rows = db
		.prepare('SELECT date, close FROM prices WHERE instrument_id = ? ORDER BY date')
		.all(instrumentId) as { date: string; close: number }[];
	return new Map(rows.map((r) => [r.date, r.close]));
}

export function allBrokers(): Broker[] {
	return db
		.prepare(
			'SELECT id, name, logo_mime, (logo IS NOT NULL) AS has_logo FROM brokers ORDER BY name'
		)
		.all() as Broker[];
}

export interface Card {
	id: number;
	name: string;
	logo_mime: string | null;
	has_logo: 0 | 1;
}

export function allCards(): Card[] {
	return db
		.prepare('SELECT id, name, logo_mime, (logo IS NOT NULL) AS has_logo FROM cards ORDER BY name')
		.all() as Card[];
}

/** FX series: date (YYYY-MM-DD) -> rate (units of quote currency per 1 EUR, e.g. EURUSD ~1.08). */
export function fxHistory(pair: string): Map<string, number> {
	const rows = db
		.prepare('SELECT date, rate FROM fx_rates WHERE pair = ? ORDER BY date')
		.all(pair) as { date: string; rate: number }[];
	return new Map(rows.map((r) => [r.date, r.rate]));
}

export function upsertFxRates(pair: string, rows: { date: string; close: number }[]) {
	const stmt = db.prepare(
		'INSERT INTO fx_rates (pair, date, rate) VALUES (?, ?, ?) ON CONFLICT(pair, date) DO UPDATE SET rate = excluded.rate'
	);
	const insertMany = db.transaction((items: { date: string; close: number }[]) => {
		for (const r of items) stmt.run(pair, r.date, r.close);
	});
	insertMany(rows);
}

export function upsertPrices(instrumentId: number, rows: { date: string; close: number }[]) {
	const stmt = db.prepare(
		'INSERT INTO prices (instrument_id, date, close) VALUES (?, ?, ?) ON CONFLICT(instrument_id, date) DO UPDATE SET close = excluded.close'
	);
	const insertMany = db.transaction((items: { date: string; close: number }[]) => {
		for (const r of items) stmt.run(instrumentId, r.date, r.close);
	});
	insertMany(rows);
}
