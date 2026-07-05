import type { Position } from './portfolio';

/**
 * Stime fiscali per investitore privato italiano.
 * ETF armonizzati (banca italiana, regime amministrato): 26% sulle plusvalenze,
 * trattenuto dalla banca alla vendita (aliquota per-strumento: gli ETF con
 * quota titoli di stato whitelist scontano il 12,5% su quella parte — configurabile).
 * Cripto su exchange estero (regime dichiarativo, quadro RT/RW):
 * 26% fino al 2025, 33% dal 2026 (L. 207/2024). IVAFE 0,2% sul valore.
 * Imposta di bollo 0,2%/anno sul deposito titoli.
 */

export const BOLLO_RATE = 0.002;
export const IVAFE_RATE = 0.002;

export function cryptoRateForYear(year: number): number {
	return year >= 2026 ? 33 : 26;
}

export interface TaxYearRealized {
	year: number;
	etfGains: number; // plusvalenze ETF realizzate (tassate dalla banca)
	etfLosses: number; // minusvalenze ETF (zainetto fiscale, non compensabili con gain ETF)
	etfTaxWithheld: number; // stima imposta trattenuta dalla banca
	cryptoGains: number; // plusvalenze nette crypto (compensabili tra loro)
	cryptoTaxDue: number; // stima imposta da versare (dichiarativo)
}

export interface TaxSummary {
	latentEtfTax: number; // tasse sulle plusvalenze ETF non ancora realizzate
	latentCryptoTax: number;
	realizedByYear: TaxYearRealized[];
	bolloYearly: number; // 0,2% valore ETF
	ivafeYearly: number; // 0,2% valore crypto
	terYearly: number; // costo TER annuo stimato
	netProfit: number; // profitto lordo - tasse (realizzate + latenti)
	grossProfit: number;
}

export function buildTaxSummary(positions: Position[]): TaxSummary {
	let latentEtfTax = 0;
	let latentCryptoTax = 0;
	let terYearly = 0;
	let etfValue = 0;
	let cryptoValue = 0;
	const currentYear = new Date().getFullYear();
	const byYear = new Map<number, TaxYearRealized>();

	const yearEntry = (year: number): TaxYearRealized => {
		let e = byYear.get(year);
		if (!e) {
			e = { year, etfGains: 0, etfLosses: 0, etfTaxWithheld: 0, cryptoGains: 0, cryptoTaxDue: 0 };
			byYear.set(year, e);
		}
		return e;
	};

	for (const p of positions) {
		const isCrypto = p.instrument.type === 'crypto';
		if (isCrypto) cryptoValue += p.value;
		else {
			etfValue += p.value;
			terYearly += (p.instrument.ter_pct / 100) * p.value;
		}

		if (p.unrealized > 0) {
			const rate = isCrypto ? cryptoRateForYear(currentYear) : p.instrument.tax_rate_pct;
			const tax = p.unrealized * (rate / 100);
			if (isCrypto) latentCryptoTax += tax;
			else latentEtfTax += tax;
		}

		for (const ev of p.realizedEvents) {
			const year = Number(ev.date.slice(0, 4));
			const e = yearEntry(year);
			if (isCrypto) {
				e.cryptoGains += ev.gain; // gains/losses compensabili tra loro nell'anno
			} else if (ev.gain >= 0) {
				e.etfGains += ev.gain;
				e.etfTaxWithheld += ev.gain * (p.instrument.tax_rate_pct / 100);
			} else {
				e.etfLosses += -ev.gain;
			}
		}
	}

	for (const e of byYear.values()) {
		e.cryptoTaxDue = Math.max(0, e.cryptoGains) * (cryptoRateForYear(e.year) / 100);
	}

	const realizedByYear = [...byYear.values()].sort((a, b) => b.year - a.year);
	const realizedTax = realizedByYear.reduce((s, e) => s + e.etfTaxWithheld + e.cryptoTaxDue, 0);
	const grossProfit = positions.reduce((s, p) => s + p.unrealized + p.realizedTotal, 0);

	return {
		latentEtfTax,
		latentCryptoTax,
		realizedByYear,
		bolloYearly: etfValue * BOLLO_RATE,
		ivafeYearly: cryptoValue * IVAFE_RATE,
		terYearly,
		grossProfit,
		netProfit: grossProfit - realizedTax - latentEtfTax - latentCryptoTax,
	};
}
