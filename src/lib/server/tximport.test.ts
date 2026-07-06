import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { NewTransaction } from './db';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-import';
fs.rmSync('tmp/test-import', { recursive: true, force: true });

const { db, insertTransactionsDedup } = await import('./db');

type Row = NewTransaction & { line: number };

function row(line: number, overrides: Partial<NewTransaction> = {}): Row {
	return {
		line,
		instrument_id: 1,
		type: 'buy',
		date: '2024-01-15',
		quantity: 10,
		price: 98.54,
		fee: 5,
		notes: null,
		broker_id: null,
		...overrides
	};
}

function count(): number {
	return (db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c;
}

beforeAll(() => {
	db.prepare(
		"INSERT INTO instruments (symbol, name, type, ter_pct, tax_rate_pct, currency) VALUES ('SWDA.MI', 'World', 'etf', 0.2, 26, 'EUR')"
	).run();
});

describe('insertTransactionsDedup', () => {
	it('inserisce righe nuove e salta quelle già nel DB', () => {
		const first = insertTransactionsDedup([row(2)]);
		expect(first.inserted).toHaveLength(1);
		expect(first.duplicates).toHaveLength(0);
		expect(count()).toBe(1);

		// stesso import ripetuto: tutto duplicato, nulla inserito
		const again = insertTransactionsDedup([row(2)]);
		expect(again.inserted).toHaveLength(0);
		expect(again.duplicates.map((d) => d.line)).toEqual([2]);
		expect(count()).toBe(1);
	});

	it('deduplica anche i doppioni interni allo stesso batch', () => {
		const { inserted, duplicates } = insertTransactionsDedup([
			row(2, { date: '2024-02-01' }),
			row(3, { date: '2024-02-01' }), // identica alla riga 2
			row(4, { date: '2024-02-02' })
		]);
		expect(inserted.map((r) => r.line)).toEqual([2, 4]);
		expect(duplicates.map((r) => r.line)).toEqual([3]);
	});

	it('una differenza in qualunque campo chiave non è un duplicato', () => {
		const base = { date: '2024-03-01' };
		insertTransactionsDedup([row(2, base)]);
		const { inserted } = insertTransactionsDedup([
			row(2, { ...base, quantity: 11 }),
			row(3, { ...base, price: 98.55 }),
			row(4, { ...base, fee: 0 }),
			row(5, { ...base, type: 'sell' })
		]);
		expect(inserted).toHaveLength(4);
	});

	it('note e broker diversi NON rendono unica una transazione identica', () => {
		insertTransactionsDedup([row(2, { date: '2024-04-01' })]);
		const { inserted, duplicates } = insertTransactionsDedup([
			row(2, { date: '2024-04-01', notes: 'nota diversa' })
		]);
		expect(inserted).toHaveLength(0);
		expect(duplicates).toHaveLength(1);
	});
});
