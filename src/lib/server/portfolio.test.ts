import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Transaction } from './db';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-data';
fs.rmSync('tmp/test-data', { recursive: true, force: true });

const { db, upsertPrices, upsertFxRates } = await import('./db');
const { buildLots, buildPosition, buildSnapshot, makeFxConverter } = await import('./portfolio');

function insertInstrument(
	symbol: string,
	type: 'etf' | 'crypto',
	ter = 0.2,
	currency = 'EUR'
): number {
	return Number(
		db
			.prepare(
				'INSERT INTO instruments (symbol, name, type, ter_pct, tax_rate_pct, currency) VALUES (?, ?, ?, ?, 26, ?)'
			)
			.run(symbol, symbol, type, ter, currency).lastInsertRowid
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
	return { id: 0, instrument_id, type, date, quantity, price, fee, notes: null, broker_id: null };
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

describe('strumenti in USD — conversione EUR via EURUSD', () => {
	it('makeFxConverter: carry-forward, backfill e identità per EUR', () => {
		upsertFxRates('EURUSD', [
			{ date: '2026-01-02', close: 1.25 },
			{ date: '2026-02-02', close: 1.1 }
		]);
		const toEur = makeFxConverter();
		expect(toEur(100, 'EUR', '2026-01-15')).toBe(100); // EUR: identità
		expect(toEur(125, 'USD', '2026-01-02')).toBeCloseTo(100); // 125 / 1,25
		expect(toEur(125, 'USD', '2026-01-20')).toBeCloseTo(100); // carry-forward
		expect(toEur(110, 'USD', '2026-03-01')).toBeCloseTo(100); // ultimo noto 1,10
		expect(toEur(125, 'USD', '2025-06-01')).toBeCloseTo(100); // backfill col primo
	});

	it('buildPosition: PMC in USD, aggregati in EUR al cambio della data', () => {
		const usdId = insertInstrument('democoin', 'crypto', 0, 'USD');
		upsertPrices(usdId, [
			{ date: '2026-01-02', close: 1000 }, // USD
			{ date: '2026-02-02', close: 1100 }
		]);
		const toEur = makeFxConverter(); // EURUSD: 1,25 poi 1,10 (dal test precedente)
		const inst = db.prepare('SELECT * FROM instruments WHERE id = ?').get(usdId) as never;
		const p = buildPosition(inst, [tx(usdId, 'buy', '2026-01-02', 1, 1000, 0)], toEur);
		expect(p.avgCost).toBeCloseTo(1000); // PMC display: USD
		expect(p.invested).toBeCloseTo(800); // 1000 / 1,25 EUR
		expect(p.costBasis).toBeCloseTo(800);
		expect(p.value).toBeCloseTo(1000); // 1100 USD / 1,10 EUR
		expect(p.unrealized).toBeCloseTo(200); // guadagno prezzo + guadagno cambio
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

describe('buildLots — singoli acquisti con consumo FIFO', () => {
	/** Come tx(), ma con id distinti: i lotti sono identificati dalla transazione. */
	function buy(id: number, date: string, quantity: number, price: number, fee = 0): Transaction {
		return { id, instrument_id: etfId, type: 'buy', date, quantity, price, fee, notes: null, broker_id: null };
	}
	function sell(id: number, date: string, quantity: number, price: number, fee = 0): Transaction {
		return { id, instrument_id: etfId, type: 'sell', date, quantity, price, fee, notes: null, broker_id: null };
	}
	const instrument = () => db.prepare('SELECT * FROM instruments WHERE id = ?').get(etfId) as never;

	it('un lotto per acquisto, commissione nel prezzo di carico, P&L sull’ultimo prezzo', () => {
		// ultimo prezzo noto dello strumento di test: 120
		const lots = buildLots(instrument(), [
			buy(1, '2026-01-02', 10, 100, 10), // carico unitario 101
			buy(2, '2026-02-02', 10, 110, 10) // carico unitario 111
		]);
		expect(lots).toHaveLength(2);
		expect(lots[0].unitCost).toBeCloseTo(101);
		expect(lots[0].remaining).toBe(10);
		expect(lots[0].costBasis).toBeCloseTo(1010);
		expect(lots[0].value).toBeCloseTo(1200);
		expect(lots[0].unrealized).toBeCloseTo(190);
		expect(lots[0].unrealizedPct).toBeCloseTo(190 / 1010);
		expect(lots[1].unitCost).toBeCloseTo(111);
		expect(lots[1].unrealized).toBeCloseTo(90); // 1200 - 1110
		expect(lots.every((l) => l.realized === 0)).toBe(true);
	});

	it('la vendita consuma i lotti dal più vecchio e assegna il realizzato', () => {
		const lots = buildLots(instrument(), [
			buy(1, '2026-01-02', 10, 100),
			buy(2, '2026-02-02', 10, 110),
			sell(3, '2026-03-02', 12, 120) // 10 dal primo lotto, 2 dal secondo
		]);
		expect(lots[0].remaining).toBe(0);
		expect(lots[0].realized).toBeCloseTo(200); // 10 × (120 - 100)
		expect(lots[0].costBasis).toBe(0); // lotto chiuso: niente più capitale a mercato
		expect(lots[1].remaining).toBeCloseTo(8);
		expect(lots[1].realized).toBeCloseTo(20); // 2 × (120 - 110)
		expect(lots[1].costBasis).toBeCloseTo(880);
		expect(lots[1].unrealized).toBeCloseTo(80); // 8 × (120 - 110)
	});

	it('la commissione di vendita riduce il ricavo del lotto venduto', () => {
		const lots = buildLots(instrument(), [buy(1, '2026-01-02', 10, 100), sell(2, '2026-03-02', 10, 120, 10)]);
		expect(lots[0].realized).toBeCloseTo(190); // 10 × 120 - 10 di commissioni - 1000
	});

	it('somma dei lotti coerente con la posizione, ed esposti nello snapshot', () => {
		const txs = [buy(1, '2026-01-02', 10, 100, 10), buy(2, '2026-02-02', 10, 110, 10)];
		const lots = buildLots(instrument(), txs);
		const p = buildPosition(instrument(), txs);
		expect(lots.reduce((s, l) => s + l.costBasis, 0)).toBeCloseTo(p.costBasis);
		expect(lots.reduce((s, l) => s + l.unrealized, 0)).toBeCloseTo(p.unrealized);

		const snap = buildSnapshot();
		expect(snap.lots.length).toBeGreaterThan(0);
		expect(snap.lots[0].instrument.symbol).toBeTruthy();
	});
});
