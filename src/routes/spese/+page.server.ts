import { fail } from '@sveltejs/kit';
import { loadMeta, transferCategories } from '$lib/server/categorize';
import { allCards, db, type Expense } from '$lib/server/db';
import {
	cardTotals,
	categoryTotals,
	categorySummaries,
	categoryTrend,
	coverage,
	distinctCards,
	expenseYears,
	monthlyInOut,
	monthsInPeriod,
	recurring,
	yearlyInOut
} from '$lib/server/expenses';
import type { Actions, PageServerLoad } from './$types';

const MOVEMENTS_LIMIT = 300;

/** Colonne ordinabili: whitelist, l'ORDER BY è interpolato nella query. */
const SORTS = {
	date: 'date',
	amount: 'amount',
	category: 'category',
	card: 'card',
	description: 'description'
} as const;
type SortKey = keyof typeof SORTS;
const isSortKey = (v: string): v is SortKey => v in SORTS;

/** Lista separata da virgole, senza vuoti né duplicati. */
const parseList = (raw: string): string[] => [
	...new Set(
		raw
			.split(',')
			.map((s) => s.trim())
			.filter((s) => s !== '')
	)
];

export const load: PageServerLoad = ({ url }) => {
	const years = expenseYears();
	const meta = loadMeta();
	const transfers = transferCategories(meta);

	// anno: parametro esplicito (anche vuoto = "tutti"); default = anno più recente con dati
	const year = url.searchParams.has('anno') ? (url.searchParams.get('anno') ?? '') : (years[0] ?? '');
	const month = url.searchParams.get('mese') ?? '';
	const category = url.searchParams.get('categoria') ?? '';
	const card = url.searchParams.get('card') ?? '';
	const q = url.searchParams.get('q') ?? '';
	// filtri di esclusione (liste): utili per togliere `unknown` o una categoria che
	// domina i totali senza dover selezionare tutte le altre a una a una
	const exCategories = parseList(url.searchParams.get('esclcat') ?? '');
	const exCards = parseList(url.searchParams.get('esclcard') ?? '');

	const sortParam = url.searchParams.get('ord') ?? '';
	const sort: SortKey = isSortKey(sortParam) ? sortParam : 'date';
	const dir = url.searchParams.get('dir') === 'asc' ? 'asc' : 'desc';

	// movimenti filtrati
	const where: string[] = [];
	const params: unknown[] = [];
	if (year) {
		where.push("substr(date, 1, 4) = ?");
		params.push(year);
	}
	if (month) {
		where.push("substr(date, 6, 2) = ?");
		params.push(month);
	}
	if (category) {
		where.push('category = ?');
		params.push(category);
	}
	if (card) {
		where.push('card = ?');
		params.push(card);
	}
	if (exCategories.length > 0) {
		where.push(`category NOT IN (${exCategories.map(() => '?').join(',')})`);
		params.push(...exCategories);
	}
	if (exCards.length > 0) {
		where.push(`card NOT IN (${exCards.map(() => '?').join(',')})`);
		params.push(...exCards);
	}
	if (q) {
		where.push("instr(lower(description), lower(?)) > 0");
		params.push(q);
	}
	const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
	// SORTS è una whitelist: `sort` non può contenere input arbitrario
	const orderSql = `ORDER BY ${SORTS[sort]} ${dir === 'asc' ? 'ASC' : 'DESC'}, id DESC`;
	const movements = db
		.prepare(`SELECT * FROM expenses ${whereSql} ${orderSql} LIMIT ${MOVEMENTS_LIMIT}`)
		.all(...params) as Expense[];
	const movementsTotal = (
		db.prepare(`SELECT COUNT(*) AS c FROM expenses ${whereSql}`).get(...params) as { c: number }
	).c;

	// dashboard
	const yearly = yearlyInOut(transfers);
	const monthly = year ? monthlyInOut(year, transfers) : [];
	const periodPrefix = year ? (month ? `${year}-${month}` : year) : '';
	const catTotals = categoryTotals(periodPrefix);
	const prevYear = year ? String(Number(year) - 1) : '';
	const prevPrefix = prevYear ? (month ? `${prevYear}-${month}` : prevYear) : '';
	const catTotalsPrev = prevPrefix ? categoryTotals(prevPrefix) : [];

	// tiles: mese corrente e YTD
	const now = new Date().toISOString().slice(0, 10);
	const curMonth = now.slice(0, 7);
	const curYear = now.slice(0, 4);
	const tileMonth = categoryTotals(curMonth);
	const tileYear = categoryTotals(curYear);
	const sumNT = (list: typeof tileMonth, field: 'moneyIn' | 'moneyOut') =>
		list.filter((c) => !transfers.has(c.category)).reduce((s, c) => s + c[field], 0);
	const topCatMonth = tileMonth.filter((c) => !transfers.has(c.category)).sort((a, b) => b.moneyOut - a.moneyOut)[0] ?? null;

	const cov = coverage(periodPrefix);

	return {
		years,
		filters: { year, month, category, card, q, exCategories, exCards },
		sort: { key: sort, dir },
		movements,
		movementsTotal,
		limit: MOVEMENTS_LIMIT,
		yearly,
		monthly,
		catTotals,
		catTotalsPrev,
		// medie mensili: denominatore = mesi con dati nel periodo (1 se è selezionato un mese)
		monthsInPeriod: month ? 1 : Math.max(1, monthsInPeriod(periodPrefix)),
		coverage: cov,
		cardTotals: cardTotals(periodPrefix, transfers),
		categoryTrend: category ? categoryTrend(category, year) : [],
		recurring: recurring(transfers),
		summaries: categorySummaries(),
		cards: distinctCards(),
		cardLogos: allCards(),
		meta,
		tiles: {
			monthOut: sumNT(tileMonth, 'moneyOut'),
			monthIn: sumNT(tileMonth, 'moneyIn'),
			ytdIn: sumNT(tileYear, 'moneyIn'),
			ytdOut: sumNT(tileYear, 'moneyOut'),
			topCatMonth: topCatMonth ? { name: topCatMonth.category, out: topCatMonth.moneyOut } : null,
			curMonth,
			curYear
		},
		hasExpenses: years.length > 0
	};
};

export const actions: Actions = {
	updateCategory: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const category = String(form.get('category') || '').trim();
		if (!id || !category) return fail(400, { section: 'movimenti', error: 'Dati mancanti.' });
		// Una categoria scelta a mano viene bloccata: le regole non la toccano più e la
		// voce non compare tra i conflitti da rivedere. Rimettere "unknown" sblocca,
		// così le regole possono di nuovo provarci.
		const manual = category === 'unknown' ? 0 : 1;
		const res = db
			.prepare('UPDATE expenses SET category = ?, category_manual = ? WHERE id = ?')
			.run(category, manual, id);
		if (res.changes === 0) return fail(400, { section: 'movimenti', error: 'Voce inesistente.' });
		return { section: 'movimenti', success: true };
	},

	unlockCategory: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { section: 'movimenti', error: 'Dati mancanti.' });
		db.prepare('UPDATE expenses SET category_manual = 0 WHERE id = ?').run(id);
		return { section: 'movimenti', success: true };
	}
};
