import { loadMeta, transferCategories } from '$lib/server/categorize';
import { db } from '$lib/server/db';
import { categoryTotals } from '$lib/server/expenses';
import { buildSnapshot } from '$lib/server/portfolio';
import { buildTaxSummary } from '$lib/server/tax';
import type { PageServerLoad } from './$types';

export interface TxMarker {
	date: string;
	type: 'buy' | 'sell';
	assetType: 'etf' | 'crypto';
	label: string; // "3 × iShares Core MSCI World"
}

export const load: PageServerLoad = () => {
	const snapshot = buildSnapshot();
	const tax = buildTaxSummary(snapshot.positions);
	const txMarkers = db
		.prepare(
			`SELECT t.date, t.type, i.type AS assetType,
				(t.quantity || ' × ' || i.name) AS label
			 FROM transactions t JOIN instruments i ON i.id = t.instrument_id
			 ORDER BY t.date, t.id`
		)
		.all() as TxMarker[];

	// riga tile spese (solo se ci sono spese)
	let spese: { monthOut: number; monthIn: number; ytdNet: number; topCat: string | null; curMonth: string; curYear: string } | null = null;
	const hasExpenses = (db.prepare('SELECT 1 FROM expenses LIMIT 1').get() as unknown) !== undefined;
	if (hasExpenses) {
		const transfers = transferCategories(loadMeta());
		const now = new Date().toISOString();
		const curMonth = now.slice(0, 7);
		const curYear = now.slice(0, 4);
		const nt = (list: ReturnType<typeof categoryTotals>) => list.filter((c) => !transfers.has(c.category));
		const m = nt(categoryTotals(curMonth));
		const y = nt(categoryTotals(curYear));
		const top = [...m].sort((a, b) => b.moneyOut - a.moneyOut)[0];
		spese = {
			monthOut: m.reduce((s, c) => s + c.moneyOut, 0),
			monthIn: m.reduce((s, c) => s + c.moneyIn, 0),
			ytdNet: y.reduce((s, c) => s + c.moneyIn - c.moneyOut, 0),
			topCat: top && top.moneyOut > 0 ? top.category : null,
			curMonth,
			curYear
		};
	}

	return { snapshot, tax, txMarkers, spese };
};
