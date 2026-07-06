import {
	allInstruments,
	allTransactions,
	fxHistory,
	priceHistory,
	type Instrument,
	type Transaction
} from './db';

/** Converte un importo dalla valuta dello strumento in EUR al cambio della data. */
export type ToEur = (amount: number, currency: string, date: string) => number;

const identityToEur: ToEur = (amount) => amount;

/** Converter EUR basato sulla serie EURUSD (USD per 1 EUR): eur = usd / rate.
 *  Cambio carry-forward (ultimo noto ≤ data), backfill col primo per date più vecchie.
 *  Senza dati FX degrada a identità (nessuna conversione). */
export function makeFxConverter(): ToEur {
	const hist = fxHistory('EURUSD');
	if (hist.size === 0) return identityToEur;
	const dates = [...hist.keys()]; // già ordinate per data
	const rates = dates.map((d) => hist.get(d)!);
	const rateOn = (date: string): number => {
		if (date <= dates[0]) return rates[0];
		let lo = 0;
		let hi = dates.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (dates[mid] <= date) lo = mid;
			else hi = mid - 1;
		}
		return rates[lo];
	};
	return (amount, currency, date) => {
		if (currency === 'EUR' || amount === 0) return amount;
		return amount / rateOn(date);
	};
}

export interface RealizedEvent {
	date: string;
	gain: number; // proceeds (net of fee) - cost basis of sold quantity
	proceeds: number;
}

/** avgCost e lastPrice sono nella valuta dello strumento (per la visualizzazione);
 *  tutti gli aggregati (costBasis, value, unrealized, realized, invested, …) sono in EUR. */
export interface Position {
	instrument: Instrument;
	quantity: number;
	avgCost: number; // PMC: prezzo medio di carico, commissioni incluse (valuta strumento)
	costBasis: number;
	lastPrice: number | null;
	lastPriceDate: string | null;
	value: number;
	unrealized: number;
	unrealizedPct: number;
	realizedTotal: number;
	realizedEvents: RealizedEvent[];
	feesPaid: number;
	invested: number; // total cash in (buys incl. fees)
	divested: number; // total cash out (sells net of fees)
	firstDate: string | null;
}

export interface DailyPoint {
	date: string;
	value: number;
	invested: number; // cumulative net cash in
	flow: number; // net cash flow of the day (+ = deposit)
	twr: number; // time-weighted return index, 1 = inception
	dailyReturn: number;
}

export interface PeriodStat {
	key: string;
	label: string;
	pct: number | null;
	abs: number | null;
}

export interface PortfolioSnapshot {
	positions: Position[];
	series: DailyPoint[];
	totalValue: number;
	totalInvested: number; // net cash in (buys - sells)
	grossProfit: number; // unrealized + realized, fees already deducted
	unrealizedTotal: number;
	realizedTotal: number;
	feesTotal: number;
	periods: PeriodStat[];
	annualizedPct: number | null;
	maxDrawdownPct: number | null;
	bestDay: { date: string; pct: number } | null;
	worstDay: { date: string; pct: number } | null;
	monthlyFlows: { month: string; invested: number; divested: number }[];
	allocation: { name: string; value: number; weight: number; type: string; id: number }[];
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
	const d = new Date(day + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

export function buildPosition(
	instrument: Instrument,
	txs: Transaction[],
	toEur: ToEur = identityToEur
): Position {
	const ccy = instrument.currency;
	let quantity = 0;
	let avgCost = 0; // PMC in valuta strumento (display)
	let avgCostEur = 0; // PMC in EUR al cambio delle date di acquisto (aggregati e fisco)
	let feesPaid = 0;
	let invested = 0;
	let divested = 0;
	const realizedEvents: RealizedEvent[] = [];

	for (const tx of txs) {
		feesPaid += toEur(tx.fee, ccy, tx.date);
		if (tx.type === 'buy') {
			const cost = tx.quantity * tx.price + tx.fee;
			const costEur = toEur(cost, ccy, tx.date);
			const newQty = quantity + tx.quantity;
			avgCost = newQty > 0 ? (quantity * avgCost + cost) / newQty : 0;
			avgCostEur = newQty > 0 ? (quantity * avgCostEur + costEur) / newQty : 0;
			quantity = newQty;
			invested += costEur;
		} else {
			const proceeds = toEur(tx.quantity * tx.price - tx.fee, ccy, tx.date);
			const gain = proceeds - tx.quantity * avgCostEur;
			realizedEvents.push({ date: tx.date, gain, proceeds });
			quantity = Math.max(0, quantity - tx.quantity);
			divested += proceeds;
			if (quantity === 0) {
				avgCost = 0;
				avgCostEur = 0;
			}
		}
	}

	const history = priceHistory(instrument.id);
	let lastPrice: number | null = null;
	let lastPriceDate: string | null = null;
	for (const [date, close] of history) {
		lastPrice = close;
		lastPriceDate = date;
	}

	const costBasis = quantity * avgCostEur;
	const value =
		lastPrice != null ? quantity * toEur(lastPrice, ccy, lastPriceDate ?? today()) : costBasis;
	const unrealized = value - costBasis;
	return {
		instrument,
		quantity,
		avgCost,
		costBasis,
		lastPrice,
		lastPriceDate,
		value,
		unrealized,
		unrealizedPct: costBasis > 0 ? unrealized / costBasis : 0,
		realizedTotal: realizedEvents.reduce((s, e) => s + e.gain, 0),
		realizedEvents,
		feesPaid,
		invested,
		divested,
		firstDate: txs[0]?.date ?? null
	};
}

/** Daily portfolio series from first transaction to today, prices carried forward
 *  (and backfilled with the earliest known price for txs older than price history). */
function buildSeries(
	instruments: Instrument[],
	txs: Transaction[],
	toEur: ToEur = identityToEur
): DailyPoint[] {
	if (txs.length === 0) return [];
	const start = txs[0].date;
	const end = today();

	const txByInstrument = new Map<number, Transaction[]>();
	for (const tx of txs) {
		if (!txByInstrument.has(tx.instrument_id)) txByInstrument.set(tx.instrument_id, []);
		txByInstrument.get(tx.instrument_id)!.push(tx);
	}

	const histories = new Map<number, Map<string, number>>();
	for (const inst of instruments) histories.set(inst.id, priceHistory(inst.id));

	const points: DailyPoint[] = [];
	const qty = new Map<number, number>();
	const lastKnown = new Map<number, number>();
	const cursor = new Map<number, number>(); // per-instrument index into its tx list
	let investedCum = 0;
	let twr = 1;

	// Backfill: seed lastKnown with the earliest available price
	for (const inst of instruments) {
		const h = histories.get(inst.id)!;
		const first = h.entries().next();
		if (!first.done) lastKnown.set(inst.id, first.value[1]);
	}

	let prevValue = 0;
	for (let day = start; day <= end; day = addDays(day, 1)) {
		let flow = 0;
		for (const inst of instruments) {
			const list = txByInstrument.get(inst.id) ?? [];
			let i = cursor.get(inst.id) ?? 0;
			while (i < list.length && list[i].date <= day) {
				const tx = list[i];
				if (tx.type === 'buy') {
					qty.set(inst.id, (qty.get(inst.id) ?? 0) + tx.quantity);
					flow += toEur(tx.quantity * tx.price + tx.fee, inst.currency, tx.date);
				} else {
					qty.set(inst.id, Math.max(0, (qty.get(inst.id) ?? 0) - tx.quantity));
					flow -= toEur(tx.quantity * tx.price - tx.fee, inst.currency, tx.date);
				}
				i++;
			}
			cursor.set(inst.id, i);
			const px = histories.get(inst.id)!.get(day);
			if (px != null) lastKnown.set(inst.id, px);
		}

		let value = 0;
		for (const inst of instruments) {
			const q = qty.get(inst.id) ?? 0;
			if (q > 0) value += q * toEur(lastKnown.get(inst.id) ?? 0, inst.currency, day);
		}

		investedCum += flow;
		const denom = prevValue + flow;
		const dailyReturn = denom > 0 ? (value - prevValue - flow) / denom : 0;
		twr *= 1 + dailyReturn;
		points.push({ date: day, value, invested: investedCum, flow, twr, dailyReturn });
		prevValue = value;
	}
	return points;
}

const PERIODS: { key: string; label: string; days: number | 'ytd' | 'max' }[] = [
	{ key: '1w', label: '1S', days: 7 },
	{ key: '1m', label: '1M', days: 30 },
	{ key: '3m', label: '3M', days: 91 },
	{ key: '6m', label: '6M', days: 182 },
	{ key: 'ytd', label: 'YTD', days: 'ytd' },
	{ key: '1y', label: '1A', days: 365 },
	{ key: 'max', label: 'MAX', days: 'max' }
];

function periodStats(series: DailyPoint[]): PeriodStat[] {
	if (series.length === 0) return PERIODS.map((p) => ({ key: p.key, label: p.label, pct: null, abs: null }));
	const end = series[series.length - 1];
	return PERIODS.map((p) => {
		let startDate: string;
		if (p.days === 'max') startDate = series[0].date;
		else if (p.days === 'ytd') startDate = end.date.slice(0, 4) + '-01-01';
		else startDate = addDays(end.date, -p.days);
		let idx = series.findIndex((pt) => pt.date >= startDate);
		if (idx === -1) idx = 0;
		// baseline = giorno prima dell'apertura della finestra; se la finestra copre
		// tutta la serie, baseline virtuale a inception (twr 1, valore 0)
		const baseIdx = idx - 1;
		const baseTwr = baseIdx >= 0 ? series[baseIdx].twr : 1;
		const baseValue = baseIdx >= 0 ? series[baseIdx].value : 0;
		if (baseIdx >= 0 && series[baseIdx] === end)
			return { key: p.key, label: p.label, pct: null, abs: null };
		const pct = baseTwr > 0 ? end.twr / baseTwr - 1 : null;
		let flows = 0;
		for (let i = baseIdx + 1; i < series.length; i++) flows += series[i].flow;
		const abs = end.value - baseValue - flows;
		return { key: p.key, label: p.label, pct, abs };
	});
}

export function buildSnapshot(): PortfolioSnapshot {
	const instruments = allInstruments();
	const txs = allTransactions();
	const toEur = makeFxConverter();
	const txByInstrument = new Map<number, Transaction[]>();
	for (const tx of txs) {
		if (!txByInstrument.has(tx.instrument_id)) txByInstrument.set(tx.instrument_id, []);
		txByInstrument.get(tx.instrument_id)!.push(tx);
	}

	const positions = instruments
		.map((inst) => buildPosition(inst, txByInstrument.get(inst.id) ?? [], toEur))
		.filter((p) => p.firstDate !== null);

	const series = buildSeries(instruments, txs, toEur);
	const totalValue = positions.reduce((s, p) => s + p.value, 0);
	const totalInvested = positions.reduce((s, p) => s + p.invested - p.divested, 0);
	const unrealizedTotal = positions.reduce((s, p) => s + p.unrealized, 0);
	const realizedTotal = positions.reduce((s, p) => s + p.realizedTotal, 0);
	const feesTotal = positions.reduce((s, p) => s + p.feesPaid, 0);

	// annualized TWR (only meaningful past ~3 months)
	let annualizedPct: number | null = null;
	if (series.length > 91) {
		const years = series.length / 365.25;
		const twrEnd = series[series.length - 1].twr;
		if (twrEnd > 0) annualizedPct = Math.pow(twrEnd, 1 / years) - 1;
	}

	let maxDrawdownPct: number | null = null;
	let peak = -Infinity;
	for (const pt of series) {
		peak = Math.max(peak, pt.twr);
		if (peak > 0) {
			const dd = pt.twr / peak - 1;
			if (maxDrawdownPct === null || dd < maxDrawdownPct) maxDrawdownPct = dd;
		}
	}

	let bestDay: { date: string; pct: number } | null = null;
	let worstDay: { date: string; pct: number } | null = null;
	for (const pt of series) {
		if (pt.dailyReturn !== 0) {
			if (!bestDay || pt.dailyReturn > bestDay.pct) bestDay = { date: pt.date, pct: pt.dailyReturn };
			if (!worstDay || pt.dailyReturn < worstDay.pct) worstDay = { date: pt.date, pct: pt.dailyReturn };
		}
	}

	const ccyById = new Map(instruments.map((i) => [i.id, i.currency]));
	const monthly = new Map<string, { invested: number; divested: number }>();
	for (const tx of txs) {
		const month = tx.date.slice(0, 7);
		const ccy = ccyById.get(tx.instrument_id) ?? 'EUR';
		const m = monthly.get(month) ?? { invested: 0, divested: 0 };
		if (tx.type === 'buy') m.invested += toEur(tx.quantity * tx.price + tx.fee, ccy, tx.date);
		else m.divested += toEur(tx.quantity * tx.price - tx.fee, ccy, tx.date);
		monthly.set(month, m);
	}
	const monthlyFlows = [...monthly.entries()]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.slice(-24)
		.map(([month, v]) => ({ month, ...v }));

	const active = positions.filter((p) => p.value > 0.005);
	const allocation = active
		.map((p) => ({
			id: p.instrument.id,
			name: p.instrument.name,
			value: p.value,
			weight: totalValue > 0 ? p.value / totalValue : 0,
			type: p.instrument.type
		}))
		.sort((a, b) => b.value - a.value);

	return {
		positions: positions.sort((a, b) => b.value - a.value),
		series,
		totalValue,
		totalInvested,
		grossProfit: unrealizedTotal + realizedTotal,
		unrealizedTotal,
		realizedTotal,
		feesTotal,
		periods: periodStats(series),
		annualizedPct,
		maxDrawdownPct,
		bestDay,
		worstDay,
		monthlyFlows,
		allocation
	};
}
