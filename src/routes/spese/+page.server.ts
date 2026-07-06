import { fail } from '@sveltejs/kit';
import { loadMeta, transferCategories } from '$lib/server/categorize';
import { allCards, db, type Expense } from '$lib/server/db';
import {
	categoryTotals,
	categorySummaries,
	distinctCards,
	expenseYears,
	monthlyInOut,
	yearlyInOut
} from '$lib/server/expenses';
import type { Actions, PageServerLoad } from './$types';

const MOVEMENTS_LIMIT = 300;

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
	if (q) {
		where.push("instr(lower(description), lower(?)) > 0");
		params.push(q);
	}
	const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
	const movements = db
		.prepare(`SELECT * FROM expenses ${whereSql} ORDER BY date DESC, id DESC LIMIT ${MOVEMENTS_LIMIT}`)
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

	return {
		years,
		filters: { year, month, category, card, q },
		movements,
		movementsTotal,
		limit: MOVEMENTS_LIMIT,
		yearly,
		monthly,
		catTotals,
		catTotalsPrev,
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
		const res = db.prepare('UPDATE expenses SET category = ? WHERE id = ?').run(category, id);
		if (res.changes === 0) return fail(400, { section: 'movimenti', error: 'Voce inesistente.' });
		return { section: 'movimenti', success: true };
	}
};
