import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from './db';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-data';
fs.rmSync('tmp/test-data', { recursive: true, force: true });

const { db, upsertPrices } = await import('./db');
const { buildPosition, buildSnapshot } = await import('./portfolio');

function insertInstrument(symbol: string, type: 'etf' | 'crypto', ter = 0.2): number {
	return Number(
		db
			.prepare(
				'INSERT INTO instruments (symbol, name, type, ter_pct, tax_rate_pct) VALUES (?, ?, ?, ?, 26)'
			)
			.run(symbol, symbol, type, ter).lastInsertRowid
	);
}

function tx(
	instrument_id: number,
	type: 'buy' | 'sell',
	date: string,
	quantity: number,
	price: number,
	fee: number
): Transaction {
	return { id: 0, instrument_id, type, date, quantity, price, fee, notes: null };
}

let etfId: number;

beforeAll(() => {
	etfId = insertInstrument('TEST.MI', 'etf');
	upsertPrices(etfId, [
		{ date: '2026-01-02', close: 100 },
		{ date: '2026-02-02', close: 110 },
		{ date: '2026-03-02', close: 120 }
	]);
});

describe('buildPosition — PMC con commissioni incluse', () => {
	it('media ponderata degli acquisti, commissioni nel costo di carico', () => {
		const inst = db.prepare('SELECT * FROM instruments WHERE id = ?').get(etfId) as never;
		const p = buildPosition(inst, [
			tx(etfId, 'buy', '2026-01-02', 10, 100, 10), // costo 1010 → PMC 101
			tx(etfId, 'buy', '2026-02-02', 10, 110, 10) // costo 1110 → PMC (1010+1110)/20 = 106
		]);
		expect(p.quantity).toBe(20);
		expect(p.avgCost).toBeCloseTo(106);
		expect(p.invested).toBeCloseTo(2120);
		expect(p.feesPaid).toBeCloseTo(20);
		// ultimo prezzo noto 120 → valore 2400, non realizzato 280
		expect(p.value).toBeCloseTo(2400);
		expect(p.unrealized).toBeCloseTo(280);
	});

	it('vendita: plusvalenza vs PMC, commissioni dedotte, PMC invariato', () => {
		const inst = db.prepare('SELECT * FROM instruments WHERE id = ?').get(etfId) as never;
		const p = buildPosition(inst, [
			tx(etfId, 'buy', '2026-01-02', 10, 100, 10),
			tx(etfId, 'buy', '2026-02-02', 10, 110, 10),
			tx(etfId, 'sell', '2026-03-02', 5, 120, 5) // ricavo 595, carico 530 → gain 65
		]);
		expect(p.quantity).toBe(15);
		expect(p.avgCost).toBeCloseTo(106); // il costo medio non cambia vendendo
		expect(p.realizedTotal).toBeCloseTo(65);
		expect(p.realizedEvents[0].gain).toBeCloseTo(65);
		expect(p.divested).toBeCloseTo(595);
	});

	it('posizione azzerata: PMC torna 0', () => {
		const inst = db.prepare('SELECT * FROM instruments WHERE id = ?').get(etfId) as never;
		const p = buildPosition(inst, [
			tx(etfId, 'buy', '2026-01-02', 10, 100, 0),
			tx(etfId, 'sell', '2026-03-02', 10, 120, 0)
		]);
		expect(p.quantity).toBe(0);
		expect(p.avgCost).toBe(0);
		expect(p.realizedTotal).toBeCloseTo(200);
	});
});

describe('buildSnapshot — serie e statistiche', () => {
	it('totali coerenti con le transazioni inserite', () => {
		db.prepare(
			'INSERT INTO transactions (instrument_id, type, date, quantity, price, fee) VALUES (?, ?, ?, ?, ?, ?)'
		).run(etfId, 'buy', '2026-01-02', 10, 100, 10);

		const s = buildSnapshot();
		expect(s.totalInvested).toBeCloseTo(1010);
		expect(s.totalValue).toBeCloseTo(1200); // 10 quote × ultimo prezzo 120
		expect(s.grossProfit).toBeCloseTo(190);
		expect(s.feesTotal).toBeCloseTo(10);
		expect(s.positions).toHaveLength(1);

		// serie giornaliera dal primo acquisto a oggi, flusso il primo giorno
		expect(s.series[0].date).toBe('2026-01-02');
		expect(s.series[0].flow).toBeCloseTo(1010);
		expect(s.series.at(-1)!.value).toBeCloseTo(1200);

		// indice TWR: 1200/1010 - 1 sull'intero periodo (nessun altro flusso)
		expect(s.periods.find((p) => p.key === 'max')!.pct).toBeCloseTo(1200 / 1010 - 1, 5);

		// P&L assoluto di periodo = ΔV - flussi
		expect(s.periods.find((p) => p.key === 'max')!.abs).toBeCloseTo(190);

		// flussi mensili
		const jan = s.monthlyFlows.find((m) => m.month === '2026-01')!;
		expect(jan.invested).toBeCloseTo(1010);
	});
});
