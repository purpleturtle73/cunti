import {
	allInstruments,
	fxHistory,
	getSetting,
	setSetting,
	upsertFxRates,
	upsertPrices,
	type Instrument
} from './db';
import { log, logError } from './log';

// UA minimale: quelli browser completi vengono spesso bloccati (429) da Yahoo
const UA = 'Mozilla/5.0';

function toDay(tsSeconds: number): string {
	return new Date(tsSeconds * 1000).toISOString().slice(0, 10);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Yahoo Finance daily closes. Borsa Italiana tickers end in .MI and quote in EUR. */
async function fetchYahoo(symbol: string, range: string): Promise<{ date: string; close: number }[]> {
	let res: Response | null = null;
	for (const attempt of ['query1', 'query2', 'query1']) {
		const url = `https://${attempt}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
		res = await fetch(url, { headers: { 'User-Agent': UA } });
		if (res.ok) break;
		if (res.status !== 429) break; // 404 ecc: inutile riprovare
		await sleep(4000);
	}
	if (!res || !res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res?.status}`);
	const json = await res.json();
	const result = json?.chart?.result?.[0];
	if (!result) throw new Error(`Yahoo ${symbol}: ${json?.chart?.error?.description ?? 'no data'}`);
	const timestamps: number[] = result.timestamp ?? [];
	const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
	const out: { date: string; close: number }[] = [];
	for (let i = 0; i < timestamps.length; i++) {
		const c = closes[i];
		if (c != null && Number.isFinite(c)) out.push({ date: toDay(timestamps[i]), close: c });
	}
	return out;
}

/** CoinGecko daily closes in the requested currency. Public API caps history at 365 days. */
async function fetchCoinGecko(
	id: string,
	days: number,
	vs = 'eur'
): Promise<{ date: string; close: number }[]> {
	const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=${vs}&days=${days}&interval=daily`;
	const res = await fetch(url, { headers: { 'User-Agent': UA } });
	if (!res.ok) throw new Error(`CoinGecko ${id}: HTTP ${res.status}`);
	const json = await res.json();
	const prices: [number, number][] = json?.prices ?? [];
	// One point per day, keep the last sample of each day
	const byDay = new Map<string, number>();
	for (const [ms, price] of prices) byDay.set(new Date(ms).toISOString().slice(0, 10), price);
	return [...byDay.entries()].map(([date, close]) => ({ date, close }));
}

export async function refreshInstrument(inst: Instrument, full: boolean): Promise<number> {
	// I prezzi vengono scaricati nella valuta dello strumento (Yahoo quota nella
	// valuta nativa del ticker; per CoinGecko si passa vs_currency).
	const rows =
		inst.type === 'crypto'
			? await fetchCoinGecko(inst.symbol, full ? 365 : 7, inst.currency.toLowerCase())
			: await fetchYahoo(inst.symbol, full ? 'max' : '10d');
	upsertPrices(inst.id, rows);
	return rows.length;
}

/** Cambio EURUSD (Yahoo "EURUSD=X", USD per 1 EUR) — serve per convertire in EUR
 *  gli strumenti quotati in USD. Storico completo al primo giro, poi incrementale. */
export async function refreshFx(): Promise<number> {
	const needsFx = allInstruments().some((i) => i.currency !== 'EUR');
	if (!needsFx) return 0;
	const full = fxHistory('EURUSD').size === 0;
	const rows = await fetchYahoo('EURUSD=X', full ? 'max' : '10d');
	upsertFxRates('EURUSD', rows);
	return rows.length;
}

export interface RefreshReport {
	at: string;
	results: { symbol: string; ok: boolean; points?: number; error?: string }[];
}

let refreshing = false;

export async function refreshAll(full = false): Promise<RefreshReport> {
	if (refreshing) {
		log('prices', 'refresh già in corso, richiesta ignorata');
		return { at: new Date().toISOString(), results: [] };
	}
	refreshing = true;
	const report: RefreshReport = { at: new Date().toISOString(), results: [] };
	const instruments = allInstruments();
	log('prices', `refresh ${full ? 'completo' : 'incrementale'} di ${instruments.length} strumenti…`);
	try {
		try {
			const points = await refreshFx();
			if (points > 0) {
				report.results.push({ symbol: 'EURUSD', ok: true, points });
				log('prices', `EURUSD: ${points} punti`);
			}
		} catch (e) {
			report.results.push({ symbol: 'EURUSD', ok: false, error: String(e) });
			logError('prices', 'EURUSD fallito', e);
		}
		for (const inst of instruments) {
			try {
				const points = await refreshInstrument(inst, full);
				report.results.push({ symbol: inst.symbol, ok: true, points });
				log('prices', `${inst.symbol}: ${points} punti`);
			} catch (e) {
				report.results.push({ symbol: inst.symbol, ok: false, error: String(e) });
				logError('prices', `${inst.symbol} fallito`, e);
			}
			// stay well under CoinGecko/Yahoo rate limits
			await new Promise((r) => setTimeout(r, 1500));
		}
		setSetting('last_refresh', report.at);
		setSetting('last_refresh_report', JSON.stringify(report.results));
		const failed = report.results.filter((r) => !r.ok).length;
		log('prices', `refresh completato: ${report.results.length - failed} ok, ${failed} falliti`);
	} finally {
		refreshing = false;
	}
	return report;
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Called once from hooks.server.ts: refresh if stale, then every 6h. */
export function startScheduler() {
	const last = getSetting('last_refresh');
	const stale = !last || Date.now() - Date.parse(last) > SIX_HOURS;
	log('prices', `scheduler avviato (ultimo refresh: ${last ?? 'mai'}${stale ? ', stantio → refresh subito' : ''})`);
	if (stale) void refreshAll().catch((e) => logError('prices', 'refresh fallito', e));
	setInterval(() => void refreshAll().catch((e) => logError('prices', 'refresh fallito', e)), SIX_HOURS);
}
