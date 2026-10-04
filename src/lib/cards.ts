/**
 * Abbinamento tra il valore del campo `card` di una spesa e le card configurate.
 *
 * Gli export bancari mettono il numero della carta nel campo (`MASTERCARD - 1234`),
 * mentre in anagrafica si configura il brand una volta sola (`Mastercard`): un
 * confronto esatto non abbinerebbe nulla e costringerebbe a una voce (con logo da
 * ricaricare) per ogni numero di carta. Quindi: confronto per **prefisso**, senza
 * distinzione di maiuscole. A parità vince il nome più lungo, così `MASTERCARD GOLD`
 * batte `MASTERCARD` quando esistono entrambi.
 */

export function normCardName(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** La card configurata che fa da prefisso al valore, o `undefined`. */
export function matchCard<T extends { name: string }>(value: string, cards: T[]): T | undefined {
	const v = normCardName(value);
	if (v === '') return undefined;
	let best: T | undefined;
	let bestLen = -1;
	for (const c of cards) {
		const n = normCardName(c.name);
		if (n === '' || !v.startsWith(n)) continue;
		if (n.length > bestLen) {
			best = c;
			bestLen = n.length;
		}
	}
	return best;
}

/** Etichetta con cui raggruppare un valore `card`: il nome configurato se abbinato,
 *  altrimenti il valore così com'è (le statistiche per card restano leggibili anche
 *  prima di aver configurato o normalizzato le card). */
export function cardGroupLabel<T extends { name: string }>(value: string, cards: T[]): string {
	return matchCard(value, cards)?.name ?? value;
}
