import type { Position } from './portfolio';

/**
 * Stime fiscali per investitore privato italiano.
 * ETF armonizzati (banca italiana, regime amministrato): 26% sulle plusvalenze,
 * trattenuto dalla banca alla vendita (aliquota per-strumento: gli ETF con
 * quota titoli di stato whitelist scontano il 12,5% su quella parte — configurabile).
 * Cripto su exchange estero (regime dichiarativo, quadro RT/RW):
 * 26% fino al 2025, 33% dal 2026 (L. 207/2024). IVAFE 0,2% sul valore.
 * Imposta di bollo 0,2%/anno sul deposito titoli.
 *
 * Zainetto fiscale: le minusvalenze sono redditi diversi e si riportano nell'anno di
 * realizzo e nei quattro successivi (art. 68 TUIR). Gli zainetti sono separati per
 * regime: quello dichiarativo (crypto) lo gestisci tu in dichiarazione, quello
 * amministrato lo tiene la banca per ogni dossier. Le plusvalenze da ETF sono redditi
 * di capitale: le minus ETF NON le compensano, compensano solo redditi diversi dello
 * stesso dossier (azioni, ETC, obbligazioni, certificati), che l'app non traccia.
 */

export const BOLLO_RATE = 0.002;
export const IVAFE_RATE = 0.002;
/** Anni successivi a quello di realizzo in cui una minusvalenza resta utilizzabile. */
export const LOSS_CARRY_YEARS = 4;

export function cryptoRateForYear(year: number): number {
	return year >= 2026 ? 33 : 26;
}

export interface TaxYearRealized {
	year: number;
	etfGains: number; // plusvalenze ETF realizzate (tassate dalla banca)
	etfLosses: number; // minusvalenze ETF (zainetto amministrato, non compensabili con gain ETF)
	etfTaxWithheld: number; // stima imposta trattenuta dalla banca
	cryptoGains: number; // risultato netto crypto dell'anno (gain e loss compensati tra loro)
	cryptoLossUsed: number; // minusvalenze di anni precedenti usate (zainetto)
	cryptoTaxable: number; // imponibile dopo la compensazione
	cryptoTaxDue: number; // stima imposta da versare (dichiarativo)
}

/** Una minusvalenza dello zainetto: anno di realizzo, uso negli anni e scadenza. */
export interface LossEntry {
	year: number; // anno di realizzo
	amount: number;
	expiresYear: number; // utilizzabile fino al 31/12 di questo anno
	used: number;
	expired: number; // quota persa perché non usata in tempo
	remaining: number; // ancora utilizzabile
	uses: { year: number; amount: number }[];
}

export interface LossPot {
	key: string;
	regime: 'dichiarativo' | 'amministrato';
	label: string;
	entries: LossEntry[]; // dalla più vecchia
	available: number; // utilizzabile oggi
	expiringThisYear: number; // residuo che scade il 31/12 dell'anno in corso
}

export interface TaxSummary {
	latentEtfTax: number; // tasse sulle plusvalenze ETF non ancora realizzate
	latentCryptoTax: number;
	realizedByYear: TaxYearRealized[];
	lossPots: LossPot[]; // zainetto fiscale: crypto (dichiarativo) e ETF per broker (amministrato)
	bolloYearly: number; // 0,2% valore ETF
	ivafeYearly: number; // 0,2% valore crypto
	terYearly: number; // costo TER annuo stimato
	netProfit: number; // profitto lordo - tasse (realizzate + latenti)
	grossProfit: number;
}

/**
 * Fa scorrere uno zainetto anno per anno fino a `currentYear`: un risultato netto
 * negativo diventa una minusvalenza, uno positivo consuma le minus disponibili dalla più
 * vecchia (FIFO, la scelta che ne fa scadere meno). Ritorna anche, per ogni anno, quanto
 * è stato usato e quanto era disponibile a inizio anno.
 */
export function runLossPot(netByYear: Map<number, number>, currentYear: number) {
	const entries: LossEntry[] = [];
	const perYear = new Map<number, { used: number; taxable: number; availableAtStart: number }>();
	const years = [...netByYear.keys()];
	const first = years.length > 0 ? Math.min(...years) : currentYear;

	for (let y = first; y <= currentYear; y++) {
		for (const e of entries)
			if (e.expiresYear < y && e.remaining > 0) {
				e.expired += e.remaining;
				e.remaining = 0;
			}
		const availableAtStart = entries.reduce((s, e) => s + e.remaining, 0);
		const net = netByYear.get(y) ?? 0;
		let used = 0;
		let taxable = 0;
		if (net < 0) {
			entries.push({ year: y, amount: -net, expiresYear: y + LOSS_CARRY_YEARS, used: 0, expired: 0, remaining: -net, uses: [] });
		} else if (net > 0) {
			taxable = net;
			for (const e of entries) {
				if (taxable <= 0) break;
				const take = Math.min(e.remaining, taxable);
				if (take <= 0) continue;
				e.remaining -= take;
				e.used += take;
				e.uses.push({ year: y, amount: take });
				taxable -= take;
				used += take;
			}
		}
		perYear.set(y, { used, taxable, availableAtStart });
	}
	return { entries, perYear };
}

const potSummary = (entries: LossEntry[], currentYear: number) => ({
	available: entries.reduce((s, e) => s + e.remaining, 0),
	expiringThisYear: entries.filter((e) => e.expiresYear === currentYear).reduce((s, e) => s + e.remaining, 0)
});

export function buildTaxSummary(
	positions: Position[],
	brokerNames: Map<number, string> = new Map(),
	currentYear = new Date().getFullYear()
): TaxSummary {
	let latentEtfTax = 0;
	let unrealizedCrypto = 0;
	let terYearly = 0;
	let etfValue = 0;
	let cryptoValue = 0;
	const byYear = new Map<number, TaxYearRealized>();
	const cryptoNet = new Map<number, number>();
	// minus ETF per dossier (broker) e anno
	const etfLossByBroker = new Map<string, Map<number, number>>();

	const yearEntry = (year: number): TaxYearRealized => {
		let e = byYear.get(year);
		if (!e) {
			e = {
				year,
				etfGains: 0,
				etfLosses: 0,
				etfTaxWithheld: 0,
				cryptoGains: 0,
				cryptoLossUsed: 0,
				cryptoTaxable: 0,
				cryptoTaxDue: 0
			};
			byYear.set(year, e);
		}
		return e;
	};

	for (const p of positions) {
		const isCrypto = p.instrument.type === 'crypto';
		if (isCrypto) {
			cryptoValue += p.value;
			unrealizedCrypto += p.unrealized; // anche le perdite: vendendo tutto si compensano
		} else {
			etfValue += p.value;
			terYearly += (p.instrument.ter_pct / 100) * p.value;
			if (p.unrealized > 0) latentEtfTax += p.unrealized * (p.instrument.tax_rate_pct / 100);
		}

		for (const ev of p.realizedEvents) {
			const year = Number(ev.date.slice(0, 4));
			const e = yearEntry(year);
			if (isCrypto) {
				e.cryptoGains += ev.gain; // gains/losses compensabili tra loro nell'anno
				cryptoNet.set(year, (cryptoNet.get(year) ?? 0) + ev.gain);
			} else if (ev.gain >= 0) {
				e.etfGains += ev.gain;
				e.etfTaxWithheld += ev.gain * (p.instrument.tax_rate_pct / 100);
			} else {
				e.etfLosses += -ev.gain;
				const key = ev.brokerId == null ? 'none' : String(ev.brokerId);
				const m = etfLossByBroker.get(key) ?? new Map<number, number>();
				m.set(year, (m.get(year) ?? 0) + ev.gain); // negativo: solo minus, nessun consumo
				etfLossByBroker.set(key, m);
			}
		}
	}

	// zainetto crypto (dichiarativo): compensa le plusvalenze degli anni successivi
	const crypto = runLossPot(cryptoNet, currentYear);
	for (const e of byYear.values()) {
		const y = crypto.perYear.get(e.year);
		e.cryptoLossUsed = y?.used ?? 0;
		e.cryptoTaxable = y?.taxable ?? Math.max(0, e.cryptoGains);
		e.cryptoTaxDue = e.cryptoTaxable * (cryptoRateForYear(e.year) / 100);
	}

	// "se vendessi tutto oggi": il latente si somma al netto già realizzato quest'anno,
	// e lo zainetto disponibile a inizio anno abbatte il totale
	const rateNow = cryptoRateForYear(currentYear) / 100;
	const realizedNow = cryptoNet.get(currentYear) ?? 0;
	const potAtStart = crypto.perYear.get(currentYear)?.availableAtStart ?? 0;
	const taxOn = (net: number) => Math.max(0, net - potAtStart) * rateNow;
	const latentCryptoTax = Math.max(0, taxOn(realizedNow + unrealizedCrypto) - taxOn(realizedNow));

	const lossPots: LossPot[] = [];
	if (crypto.entries.length > 0)
		lossPots.push({
			key: 'crypto',
			regime: 'dichiarativo',
			label: 'Crypto — regime dichiarativo',
			entries: crypto.entries,
			...potSummary(crypto.entries, currentYear)
		});
	for (const [key, net] of etfLossByBroker) {
		const { entries } = runLossPot(net, currentYear);
		const broker = key === 'none' ? 'senza broker' : (brokerNames.get(Number(key)) ?? `broker ${key}`);
		lossPots.push({
			key: `etf-${key}`,
			regime: 'amministrato',
			label: `ETF — ${broker} (regime amministrato)`,
			entries,
			...potSummary(entries, currentYear)
		});
	}

	const realizedByYear = [...byYear.values()].sort((a, b) => b.year - a.year);
	const realizedTax = realizedByYear.reduce((s, e) => s + e.etfTaxWithheld + e.cryptoTaxDue, 0);
	const grossProfit = positions.reduce((s, p) => s + p.unrealized + p.realizedTotal, 0);

	return {
		latentEtfTax,
		latentCryptoTax,
		realizedByYear,
		lossPots,
		bolloYearly: etfValue * BOLLO_RATE,
		ivafeYearly: cryptoValue * IVAFE_RATE,
		terYearly,
		grossProfit,
		netProfit: grossProfit - realizedTax - latentEtfTax - latentCryptoTax
	};
}
