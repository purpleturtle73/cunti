import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR ?? path.resolve('data');
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
`);

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

/** Price map per instrument: date (YYYY-MM-DD) -> close. */
export function priceHistory(instrumentId: number): Map<string, number> {
	const rows = db
		.prepare('SELECT date, close FROM prices WHERE instrument_id = ? ORDER BY date')
		.all(instrumentId) as { date: string; close: number }[];
	return new Map(rows.map((r) => [r.date, r.close]));
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
