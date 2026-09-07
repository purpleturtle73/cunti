const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const eur0 = new Intl.NumberFormat('it-IT', {
	style: 'currency',
	currency: 'EUR',
	maximumFractionDigits: 0
});
const num = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 6 });

export function fmtEur(v: number | null | undefined, compact = false): string {
	if (v == null || !Number.isFinite(v)) return '—';
	return compact ? eur0.format(v) : eur.format(v);
}

const currencyFmt = new Map<string, Intl.NumberFormat>();

/** Formato valuta generico, sempre locale it-IT (es. USD → "1.234,56 USD"). */
export function fmtCurrency(v: number | null | undefined, currency = 'EUR'): string {
	if (currency === 'EUR') return fmtEur(v);
	if (v == null || !Number.isFinite(v)) return '—';
	let f = currencyFmt.get(currency);
	if (!f) {
		f = new Intl.NumberFormat('it-IT', { style: 'currency', currency, currencyDisplay: 'code' });
		currencyFmt.set(currency, f);
	}
	return f.format(v);
}

export function fmtPct(v: number | null | undefined, signed = true): string {
	if (v == null || !Number.isFinite(v)) return '—';
	const s = (v * 100).toLocaleString('it-IT', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
	return (signed && v > 0 ? '+' : '') + s + '%';
}

export function fmtQty(v: number): string {
	return num.format(v);
}

export function fmtDate(day: string): string {
	const [y, m, d] = day.split('-');
	return `${d}/${m}/${y}`;
}

/** Etichetta testuale di uno strumento con ticker: "iShares Core MSCI World (SWDA.MI)".
 *  Per il markup usare invece il nome seguito da <span class="ticker">. */
export function instrumentLabel(name: string, symbol: string | null | undefined): string {
	return symbol ? `${name} (${symbol})` : name;
}

export function signClass(v: number | null | undefined): string {
	if (v == null || v === 0) return '';
	return v > 0 ? 'pos' : 'neg';
}
