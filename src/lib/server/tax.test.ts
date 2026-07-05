import { describe, expect, it } from 'vitest';
import { buildTaxSummary, cryptoRateForYear } from './tax';
import type { Position, RealizedEvent } from './portfolio';
import type { Instrument } from './db';

function makePosition(
	type: 'etf' | 'crypto',
	overrides: Omit<Partial<Position>, 'instrument'> & { instrument?: Partial<Instrument> } = {}
): Position {
	const { instrument: instrumentOverride, ...rest } = overrides;
	const instrument: Instrument = {
		id: 1,
		symbol: type === 'etf' ? 'TEST.MI' : 'testcoin',
		name: 'Test',
		type,
		isin: null,
		ter_pct: 0,
		tax_rate_pct: 26,
		currency: 'EUR',
		...instrumentOverride
	};
	return {
		quantity: 0,
		avgCost: 0,
		costBasis: 0,
		lastPrice: null,
		lastPriceDate: null,
		value: 0,
		unrealized: 0,
		unrealizedPct: 0,
		realizedTotal: 0,
		realizedEvents: [],
		feesPaid: 0,
		invested: 0,
		divested: 0,
		firstDate: '2025-01-01',
		...rest,
		instrument
	};
}

describe('cryptoRateForYear', () => {
	it('26% fino al 2025, 33% dal 2026 (L. 207/2024)', () => {
		expect(cryptoRateForYear(2024)).toBe(26);
		expect(cryptoRateForYear(2025)).toBe(26);
		expect(cryptoRateForYear(2026)).toBe(33);
		expect(cryptoRateForYear(2030)).toBe(33);
	});
});

describe('buildTaxSummary', () => {
	it('calcola imposte latenti ETF al 26%, bollo e TER', () => {
		const etf = makePosition('etf', {
			value: 10000,
			unrealized: 1000,
			instrument: { ter_pct: 0.2 }
		});
		const t = buildTaxSummary([etf]);
		expect(t.latentEtfTax).toBeCloseTo(260);
		expect(t.latentCryptoTax).toBe(0);
		expect(t.bolloYearly).toBeCloseTo(20); // 0,2% di 10.000
		expect(t.terYearly).toBeCloseTo(20); // 0,2% di 10.000
		expect(t.ivafeYearly).toBe(0);
	});

	it('rispetta aliquota per-strumento (es. 12,5% titoli di stato)', () => {
		const etf = makePosition('etf', {
			value: 10000,
			unrealized: 1000,
			instrument: { tax_rate_pct: 12.5 }
		});
		expect(buildTaxSummary([etf]).latentEtfTax).toBeCloseTo(125);
	});

	it('nessuna imposta latente su posizioni in perdita', () => {
		const etf = makePosition('etf', { value: 900, unrealized: -100 });
		const t = buildTaxSummary([etf]);
		expect(t.latentEtfTax).toBe(0);
	});

	it('crypto: aliquota per anno di realizzo, gains e losses compensati nello stesso anno', () => {
		const events: RealizedEvent[] = [
			{ date: '2025-03-01', gain: 1500, proceeds: 5000 },
			{ date: '2025-09-01', gain: -500, proceeds: 1000 }, // compensata
			{ date: '2026-02-01', gain: 1000, proceeds: 3000 }
		];
		const crypto = makePosition('crypto', {
			value: 5000,
			realizedEvents: events,
			realizedTotal: 2000
		});
		const t = buildTaxSummary([crypto]);
		const y2025 = t.realizedByYear.find((y) => y.year === 2025)!;
		const y2026 = t.realizedByYear.find((y) => y.year === 2026)!;
		expect(y2025.cryptoGains).toBeCloseTo(1000); // 1500 - 500
		expect(y2025.cryptoTaxDue).toBeCloseTo(260); // 26%
		expect(y2026.cryptoTaxDue).toBeCloseTo(330); // 33%
		expect(t.ivafeYearly).toBeCloseTo(10); // 0,2% di 5.000
	});

	it('ETF: minusvalenze non compensano le plusvalenze (redditi di capitale)', () => {
		const etf = makePosition('etf', {
			realizedEvents: [
				{ date: '2026-01-10', gain: 500, proceeds: 2000 },
				{ date: '2026-04-10', gain: -200, proceeds: 800 }
			],
			realizedTotal: 300
		});
		const t = buildTaxSummary([etf]);
		const y = t.realizedByYear.find((x) => x.year === 2026)!;
		expect(y.etfGains).toBeCloseTo(500);
		expect(y.etfLosses).toBeCloseTo(200);
		expect(y.etfTaxWithheld).toBeCloseTo(130); // 26% dei 500, la minus NON riduce
	});

	it('netProfit = lordo - imposte realizzate - imposte latenti', () => {
		const etf = makePosition('etf', {
			value: 11000,
			unrealized: 1000,
			realizedEvents: [{ date: '2026-01-10', gain: 500, proceeds: 2000 }],
			realizedTotal: 500
		});
		const t = buildTaxSummary([etf]);
		expect(t.grossProfit).toBeCloseTo(1500);
		expect(t.netProfit).toBeCloseTo(1500 - 130 - 260);
	});
});
