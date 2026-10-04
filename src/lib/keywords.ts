/**
 * Keyword suggerita per "Crea regola da questa voce".
 *
 * Le descrizioni bancarie iniziano quasi sempre con parole che dicono il tipo di
 * operazione, non chi è l'esercente ("PAGAMENTO POS", "ADDEBITO SDD"), e finiscono con
 * numeri e riferimenti che cambiano a ogni voce. Si saltano le prime e ci si ferma ai
 * secondi: resta il nome dell'esercente. Il risultato è sempre un pezzo esatto della
 * descrizione (minuscolo), così la regola riconosce davvero la voce da cui nasce.
 */

const GENERIC = new Set([
	'pagamento',
	'pag',
	'pos',
	'addebito',
	'accredito',
	'sdd',
	'sepa',
	'rid',
	'acquisto',
	'acq',
	'carta',
	'card',
	'bonifico',
	'disposto',
	'ricevuto',
	'a',
	'da',
	'di',
	'del',
	'della',
	'presso',
	'favore',
	'vostro',
	'op',
	'operazione',
	'contactless',
	'ecommerce',
	'e-commerce',
	'mastercard',
	'visa',
	'maestro'
]);

/** Primo token "vero" più, se è corto (sigle, nomi brevi), quello successivo. */
export function suggestKeyword(description: string): string {
	const lower = description.toLowerCase();
	const tokens = [...lower.matchAll(/\S+/g)].map((m) => ({
		text: m[0],
		start: m.index ?? 0,
		end: (m.index ?? 0) + m[0].length
	}));
	const clean = (t: string) => t.replace(/[.,:;*/\\-]+$/g, '').replace(/^[.,:;*/\\-]+/g, '');
	const meaningful = (t: string) => {
		const c = clean(t);
		return c.length >= 2 && !/\d/.test(c) && !GENERIC.has(c);
	};

	const i = tokens.findIndex((t) => meaningful(t.text));
	if (i < 0) return lower.trim().slice(0, 40);
	const first = clean(tokens[i].text);
	const start = tokens[i].start + tokens[i].text.indexOf(first);
	let end = start + first.length;
	const next = tokens[i + 1];
	if (first.length < 6 && next && meaningful(next.text)) {
		const second = clean(next.text);
		end = next.start + next.text.indexOf(second) + second.length;
	}
	return lower.slice(start, end);
}
