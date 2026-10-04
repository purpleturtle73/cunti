import { fail } from '@sveltejs/kit';
import { listCategoryDefs, loadMeta, transferCategories } from '$lib/server/categorize';
import { allCards, db, type Expense } from '$lib/server/db';
import {
	balanceSeries,
	budgetStatus,
	cardTotals,
	categoryTotals,
	categorySummaries,
	categoryTrend,
	coverage,
	createRuleFromMovement,
	distinctCards,
	expenseYears,
	filterConditions,
	filteredInOut,
	monthlyInOut,
	monthsInPeriod,
	listBudgets,
	recurring,
	setBudgets,
	yearlyInOut,
	type ExpenseFilters
} from '$lib/server/expenses';
import type { Actions, PageServerLoad } from './$types';

const MOVEMENTS_LIMIT = 100;

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
	const filters: ExpenseFilters = { year, month, category, card, q, exCategories, exCards };
	const { where, params } = filterConditions(filters);
	const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
	// SORTS è una whitelist: `sort` non può contenere input arbitrario
	const orderSql = `ORDER BY ${SORTS[sort]} ${dir === 'asc' ? 'ASC' : 'DESC'}, id DESC`;
	const movementsTotal = (
		db.prepare(`SELECT COUNT(*) AS c FROM expenses ${whereSql}`).get(...params) as { c: number }
	).c;
	// pagine da MOVEMENTS_LIMIT righe; una pagina fuori intervallo ricade sull'ultima valida
	const pages = Math.max(1, Math.ceil(movementsTotal / MOVEMENTS_LIMIT));
	const pageParam = Number.parseInt(url.searchParams.get('pag') ?? '1', 10);
	const pageNo = Math.min(pages, Math.max(1, Number.isFinite(pageParam) ? pageParam : 1));
	const movements = db
		.prepare(`SELECT * FROM expenses ${whereSql} ${orderSql} LIMIT ? OFFSET ?`)
		.all(...params, MOVEMENTS_LIMIT, (pageNo - 1) * MOVEMENTS_LIMIT) as Expense[];

	// dashboard
	const yearly = yearlyInOut(transfers);
	const monthly = year ? monthlyInOut(year, transfers) : [];
	const periodPrefix = year ? (month ? `${year}-${month}` : year) : '';
	const catTotals = categoryTotals(periodPrefix);
	const prevYear = year ? String(Number(year) - 1) : '';
	const prevPrefix = prevYear ? (month ? `${prevYear}-${month}` : prevYear) : '';
	const catTotalsPrev = prevPrefix ? categoryTotals(prevPrefix) : [];

	// tiles: entrate/uscite del periodo con i filtri; saldo e top categoria su oggi
	const inOut = filteredInOut(transfers, filters);
	const now = new Date().toISOString().slice(0, 10);
	const curMonth = now.slice(0, 7);
	const curYear = now.slice(0, 4);
	const tileMonth = categoryTotals(curMonth);
	const tileYear = categoryTotals(curYear);
	const sumNT = (list: typeof tileMonth, field: 'moneyIn' | 'moneyOut') =>
		list.filter((c) => !transfers.has(c.category)).reduce((s, c) => s + c[field], 0);
	const topCatMonth = tileMonth.filter((c) => !transfers.has(c.category)).sort((a, b) => b.moneyOut - a.moneyOut)[0] ?? null;

	const cov = coverage(periodPrefix);

	// la tile "Ricorrenti attive" parla di oggi e resta globale; la card segue i filtri
	const activeRecurring = recurring(transfers).filter((r) => r.active);
	const defs = listCategoryDefs();
	const budgets = listBudgets();

	return {
		years,
		filters,
		sort: { key: sort, dir },
		movements,
		movementsTotal,
		limit: MOVEMENTS_LIMIT,
		pagination: { page: pageNo, pages },
		// categorie definite (con regole): le sole a cui si può aggiungere una keyword
		definedCategories: defs.map((c) => c.name),
		budget: budgetStatus(year, month),
		// categorie a cui si può dare un budget: definite e non giroconti
		budgetCategories: defs
			.filter((c) => !c.transfer)
			.map((c) => ({ name: c.name, monthly: budgets.get(c.name) ?? null })),
		yearly,
		monthly,
		catTotals,
		catTotalsPrev,
		// medie mensili: denominatore = mesi con dati nel periodo (1 se è selezionato un mese)
		monthsInPeriod: month ? 1 : Math.max(1, monthsInPeriod(periodPrefix)),
		coverage: cov,
		cardTotals: cardTotals(periodPrefix, transfers),
		categoryTrend: category ? categoryTrend(category, year) : [],
		balance: balanceSeries(transfers, filters),
		recurring: recurring(transfers, filters),
		recurringOutflow: inOut.moneyOut,
		recurringActive: {
			count: activeRecurring.length,
			monthly: activeRecurring.reduce((s, r) => s + r.amount, 0)
		},
		summaries: categorySummaries(),
		cards: distinctCards(),
		cardLogos: allCards(),
		meta,
		tiles: {
			periodIn: inOut.moneyIn,
			periodOut: inOut.moneyOut,
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

	saveBudgets: async ({ request }) => {
		const form = await request.formData();
		const allowed = new Set(listCategoryDefs().filter((c) => !c.transfer).map((c) => c.name));
		const entries = new Map<string, number | null>();
		for (const [name, value] of form.entries()) {
			if (!name.startsWith('b:')) continue;
			const category = name.slice(2);
			if (!allowed.has(category)) continue;
			const raw = String(value).trim().replace(/\s/g, '').replace(',', '.');
			if (raw === '') {
				entries.set(category, null);
				continue;
			}
			const n = Number(raw);
			if (!Number.isFinite(n) || n < 0)
				return fail(400, { section: 'budget', error: `Budget non valido per "${category}": usa un importo in euro (vuoto = nessun budget).` });
			entries.set(category, n);
		}
		const set = setBudgets(entries);
		return { section: 'budget', success: `Budget salvati: ${set} categorie con un budget mensile.` };
	},

	createRule: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const category = String(form.get('category') || '').trim();
		if (!id || !category) return fail(400, { section: 'regola', error: 'Scegli keyword e categoria.' });
		const res = createRuleFromMovement(id, String(form.get('keyword') || ''), category, form.get('apply') === 'on');
		if (!res.ok) return fail(400, { section: 'regola', error: res.error });
		const parts = [`Keyword "${res.keyword}" aggiunta a "${category}"`];
		if (form.get('apply') === 'on') parts.push(`${res.applied} voci senza categoria categorizzate`);
		return { section: 'regola', success: parts.join(': ') + '.', newConflicts: res.newConflicts };
	},

	unlockCategory: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { section: 'movimenti', error: 'Dati mancanti.' });
		db.prepare('UPDATE expenses SET category_manual = 0 WHERE id = ?').run(id);
		return { section: 'movimenti', success: true };
	}
};
