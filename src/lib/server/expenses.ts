/**
 * Import spese a due fasi (staging + anteprima + conferma), dedup a conteggio,
 * export CSV round-trip, svuotamento con backup, query per la dashboard.
 *
 * Dedup a conteggio: chiave = data + descrizione + card + importo. La stessa chiave
 * può ripetersi legittimamente (due spese identiche nello stesso giorno): per ogni
 * chiave si inseriscono solo le occorrenze presenti nel file oltre quelle già nel DB.
 * La categoria NON fa parte della chiave: una riga con chiave esistente ma categoria
 * diversa è un "conflitto" mostrato in anteprima (scelta: tieni DB / usa CSV).
 */
import { cardGroupLabel } from '../cards';
import { createBackup } from './backup';
import { addKeyword, loadRules, matchCategory } from './categorize';
import { allCards, db, type Expense } from './db';
import { log } from './log';
import {
	discardStaging as discardStagingFile,
	readStaging,
	writeStaging
} from './staging';
import type { ParsedExpense } from './expensecsv';

export interface StagedRow {
	line: number;
	date: string;
	description: string;
	card: string;
	amount: number;
	category: string;
	source: 'csv' | 'rules' | 'unknown';
}

export interface ImportConflict {
	date: string;
	description: string;
	card: string;
	amount: number;
	dbCategory: string;
	csvCategory: string;
	dbRows: number; // quante righe nel DB condividono la chiave
}

export interface ImportPreview {
	token: string;
	total: number;
	toInsert: number;
	skippedDuplicates: number;
	conflicts: ImportConflict[];
	bySource: { csv: number; rules: number; unknown: number };
	newCategories: string[];
	rulesError: string | null;
	rulesWarnings: number;
}

const keyOf = (r: { date: string; description: string; card: string; amount: number }) =>
	`${r.date}|${r.description}|${r.card}|${r.amount.toFixed(2)}`;

/** Applica card di default e categorizza (categoria CSV vince, poi regole, poi unknown). */
export function categorizeRows(rows: ParsedExpense[], defaultCard: string): { staged: StagedRow[]; rulesError: string | null; rulesWarnings: number } {
	const rules = loadRules();
	const staged = rows.map((r) => {
		let category = r.category;
		let source: StagedRow['source'] = 'csv';
		if (!category) {
			const m = matchCategory(r.description, rules.rules);
			category = m?.category ?? 'unknown';
			source = m ? 'rules' : 'unknown';
		}
		return {
			line: r.line,
			date: r.date,
			description: r.description,
			card: r.card ?? defaultCard,
			amount: r.amount,
			category,
			source
		};
	});
	return { staged, rulesError: rules.error, rulesWarnings: rules.warnings.length };
}

interface StagingFile {
	createdAt: string;
	rows: StagedRow[]; // solo quelle da inserire
	conflicts: ImportConflict[];
}

/** Costruisce l'anteprima e salva lo staging su file. Nessuna scrittura sul DB. */
export function stageImport(rows: ParsedExpense[], defaultCard: string): ImportPreview {
	const { staged, rulesError, rulesWarnings } = categorizeRows(rows, defaultCard);

	// occorrenze già nel DB per chiave (con categorie presenti)
	const dbRows = db.prepare('SELECT date, description, card, amount, category FROM expenses').all() as Omit<Expense, 'id'>[];
	const dbByKey = new Map<string, { count: number; categories: Map<string, number> }>();
	for (const r of dbRows) {
		const k = keyOf(r);
		let e = dbByKey.get(k);
		if (!e) dbByKey.set(k, (e = { count: 0, categories: new Map() }));
		e.count++;
		e.categories.set(r.category, (e.categories.get(r.category) ?? 0) + 1);
	}

	const existingCategories = new Set(dbRows.map((r) => r.category));

	const seen = new Map<string, number>(); // occorrenze già viste nel file per chiave
	const toInsert: StagedRow[] = [];
	const conflicts = new Map<string, ImportConflict>();
	let skipped = 0;
	const bySource = { csv: 0, rules: 0, unknown: 0 };
	const newCategories = new Set<string>();

	for (const r of staged) {
		bySource[r.source]++;
		if (!existingCategories.has(r.category)) newCategories.add(r.category);
		const k = keyOf(r);
		const nSeen = (seen.get(k) ?? 0) + 1;
		seen.set(k, nSeen);
		const inDb = dbByKey.get(k);
		if (inDb && nSeen <= inDb.count) {
			skipped++;
			// stessa chiave ma categoria diversa da quelle nel DB → conflitto
			if (!inDb.categories.has(r.category)) {
				const dbCategory = [...inDb.categories.keys()][0];
				conflicts.set(k, {
					date: r.date,
					description: r.description,
					card: r.card,
					amount: r.amount,
					dbCategory,
					csvCategory: r.category,
					dbRows: inDb.count
				});
			}
		} else {
			toInsert.push(r);
		}
	}

	const payload: StagingFile = { createdAt: new Date().toISOString(), rows: toInsert, conflicts: [...conflicts.values()] };
	const token = writeStaging('spese', payload);

	return {
		token,
		total: staged.length,
		toInsert: toInsert.length,
		skippedDuplicates: skipped,
		conflicts: payload.conflicts,
		bySource,
		newCategories: [...newCategories].sort(),
		rulesError,
		rulesWarnings
	};
}

export function discardStaging(token: string) {
	discardStagingFile('spese', token);
}

/** Applica lo staging: inserisce le nuove righe e risolve i conflitti scelti come "csv". */
export function applyStaging(
	token: string,
	useCsvCategory: Set<string> // chiavi (keyOf) dei conflitti da aggiornare alla categoria del CSV
): { inserted: number; updatedCategories: number } | null {
	const staging = readStaging<StagingFile>('spese', token);
	if (!staging) return null;

	const insert = db.prepare(
		'INSERT INTO expenses (date, description, card, amount, category) VALUES (?, ?, ?, ?, ?)'
	);
	const updateCat = db.prepare(
		'UPDATE expenses SET category = ? WHERE date = ? AND description = ? AND card = ? AND ROUND(amount, 2) = ROUND(?, 2)'
	);

	let updatedCategories = 0;
	db.transaction(() => {
		for (const r of staging.rows) insert.run(r.date, r.description, r.card, r.amount, r.category);
		for (const c of staging.conflicts) {
			if (useCsvCategory.has(keyOf(c))) {
				const res = updateCat.run(c.csvCategory, c.date, c.description, c.card, c.amount);
				updatedCategories += res.changes;
			}
		}
	})();

	discardStaging(token);
	log('spese', `import applicato: ${staging.rows.length} inserite, ${updatedCategories} categorie aggiornate da conflitti`);
	return { inserted: staging.rows.length, updatedCategories };
}

export const conflictKey = keyOf;

/** Export CSV completo, stesso formato dell'import (round-trip). */
export function exportExpensesCsv(): string {
	const rows = db
		.prepare('SELECT date, description, card, amount, category FROM expenses ORDER BY date, id')
		.all() as Omit<Expense, 'id'>[];
	const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
	const toIt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
	const lines = ['data_ops;descrizione;card;importo;moneyin;moneyout;categoria'];
	for (const r of rows) {
		const moneyin = r.amount >= 0 ? r.amount : 0;
		const moneyout = r.amount < 0 ? -r.amount : 0;
		lines.push(
			[toIt(r.date), esc(r.description), esc(r.card), r.amount.toFixed(2), moneyin.toFixed(2), moneyout.toFixed(2), esc(r.category)].join(';')
		);
	}
	return lines.join('\n') + '\n';
}

/** Svuota le spese; prima crea un backup automatico del DB. */
export async function wipeExpenses(): Promise<number> {
	await createBackup();
	const info = db.prepare('DELETE FROM expenses').run();
	log('spese', `svuotate ${info.changes} spese (backup creato prima del wipe)`);
	return info.changes;
}

// ---------- Filtri della pagina Spese ----------

export interface ExpenseFilters {
	year: string; // '' = tutti gli anni
	month: string; // '01'..'12', '' = tutti
	category: string;
	card: string; // valore grezzo del campo card
	q: string; // sottostringa della descrizione
	exCategories: string[];
	exCards: string[]; // nomi di card configurate o valori grezzi
}

export const NO_FILTERS: ExpenseFilters = {
	year: '',
	month: '',
	category: '',
	card: '',
	q: '',
	exCategories: [],
	exCards: []
};

/** Valori grezzi del campo card coperti dalle card escluse. Il pannello "Spesa per card"
 *  esclude per nome della card configurata (`Mastercard`), mentre le righe hanno il valore
 *  grezzo (`MASTERCARD - 1234`): stessa regola di abbinamento della UI. */
function excludedCardValues(labels: string[]): string[] {
	if (labels.length === 0) return [];
	const wanted = new Set(labels);
	const cards = allCards();
	return distinctCards().filter((v) => wanted.has(v) || wanted.has(cardGroupLabel(v, cards)));
}

/**
 * Condizioni SQL dei filtri della pagina Spese, da unire in AND. Con `period: false`
 * anno e mese restano fuori: serve a chi deve guardare tutto lo storico e restringe il
 * periodo per conto suo (le ricorrenti si riconoscono solo su più mesi).
 */
export function filterConditions(
	f: ExpenseFilters,
	opts: { period?: boolean } = {}
): { where: string[]; params: unknown[] } {
	const where: string[] = [];
	const params: unknown[] = [];
	if (opts.period !== false) {
		if (f.year) {
			where.push('substr(date, 1, 4) = ?');
			params.push(f.year);
		}
		if (f.month) {
			where.push('substr(date, 6, 2) = ?');
			params.push(f.month);
		}
	}
	if (f.category) {
		where.push('category = ?');
		params.push(f.category);
	}
	if (f.card) {
		where.push('card = ?');
		params.push(f.card);
	}
	if (f.exCategories.length > 0) {
		where.push(`category NOT IN (${f.exCategories.map(() => '?').join(',')})`);
		params.push(...f.exCategories);
	}
	const exCards = excludedCardValues(f.exCards);
	if (exCards.length > 0) {
		where.push(`card NOT IN (${exCards.map(() => '?').join(',')})`);
		params.push(...exCards);
	}
	if (f.q) {
		where.push('instr(lower(description), lower(?)) > 0');
		params.push(f.q);
	}
	return { where, params };
}

/** La data cade nel periodo dei filtri (anno e/o mese; nessuno = sempre). */
const inPeriod = (f: ExpenseFilters, date: string) =>
	(!f.year || date.slice(0, 4) === f.year) && (!f.month || date.slice(5, 7) === f.month);

/** Condizioni per i movimenti non giroconto che passano i filtri. Una categoria scelta
 *  esplicitamente vince sull'esclusione dei giroconti: chi filtra "investimenti" vuole
 *  vedere il versamento mensile, anche se è un giroconto. */
function nonTransferConditions(transfers: Set<string>, f: ExpenseFilters, period: boolean) {
	const { where, params } = filterConditions(f, { period });
	if (!f.category && transfers.size > 0) {
		where.push(`category NOT IN (${[...transfers].map(() => '?').join(',')})`);
		params.push(...transfers);
	}
	return { where, params };
}

/** Entrate e uscite (positive) del periodo con i filtri, giroconti esclusi: le tile in
 *  cima alla pagina e il denominatore della quota ricorrenti. */
export function filteredInOut(transfers: Set<string>, f: ExpenseFilters): { moneyIn: number; moneyOut: number } {
	const { where, params } = nonTransferConditions(transfers, f, true);
	return db
		.prepare(
			`SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS moneyIn,
				COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END), 0) AS moneyOut
			 FROM expenses ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`
		)
		.get(...params) as { moneyIn: number; moneyOut: number };
}

// ---------- Budget per categoria ----------

export interface BudgetRow {
	category: string;
	monthly: number;
	budget: number; // per il periodo (mensile × mesi)
	spent: number; // uscite del periodo (positivo)
	pct: number; // spent / budget
	expected: number | null; // spesa "in linea" a oggi, se il periodo è in corso
	state: 'ok' | 'warn' | 'over';
}

export interface BudgetStatus {
	kind: 'month' | 'year';
	key: string; // YYYY-MM o YYYY
	months: number;
	pace: number | null; // frazione del periodo trascorsa (null se il periodo non è in corso)
	rows: BudgetRow[];
	totalBudget: number;
	totalSpent: number;
	over: number; // categorie oltre il budget
}

export function listBudgets(): Map<string, number> {
	return new Map(
		(db.prepare('SELECT category, monthly FROM budgets').all() as { category: string; monthly: number }[]).map((r) => [
			r.category,
			r.monthly
		])
	);
}

/** Imposta i budget mensili: `null` o 0 toglie il budget della categoria. */
export function setBudgets(entries: Map<string, number | null>): number {
	const upsert = db.prepare(
		'INSERT INTO budgets (category, monthly) VALUES (?, ?) ON CONFLICT(category) DO UPDATE SET monthly = excluded.monthly'
	);
	const del = db.prepare('DELETE FROM budgets WHERE category = ?');
	let set = 0;
	db.transaction(() => {
		for (const [category, monthly] of entries) {
			if (monthly == null || monthly <= 0) del.run(category);
			else {
				upsert.run(category, Math.round(monthly * 100) / 100);
				set++;
			}
		}
	})();
	return set;
}

/**
 * Stato dei budget nel periodo dei filtri: anno + mese → quel mese; solo anno → l'anno
 * intero (budget × 12); nessuno → il mese corrente. Conta le uscite della categoria,
 * qualunque card: il budget è sulla categoria. "Attenzione" quando si è oltre il 90% del
 * budget o più del 10% sopra il ritmo atteso a oggi; "sforato" oltre il 100%.
 */
export function budgetStatus(year: string, month: string, today = new Date()): BudgetStatus {
	const todayIso = today.toISOString().slice(0, 10);
	let kind: 'month' | 'year' = 'month';
	let key: string;
	if (year && month) key = `${year}-${month}`;
	else if (year) {
		kind = 'year';
		key = year;
	} else key = todayIso.slice(0, 7);
	const months = kind === 'year' ? 12 : 1;

	// frazione del periodo trascorsa, solo se oggi cade nel periodo
	let pace: number | null = null;
	if (todayIso.startsWith(key)) {
		const y = Number(todayIso.slice(0, 4));
		const m = Number(todayIso.slice(5, 7));
		const d = Number(todayIso.slice(8, 10));
		const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
		pace = kind === 'month' ? d / daysInMonth : (m - 1 + d / daysInMonth) / 12;
	}

	const budgets = listBudgets();
	const spentByCat = new Map(
		(
			db
				.prepare(
					`SELECT category, SUM(-amount) AS spent FROM expenses
					 WHERE amount < 0 AND date LIKE ? || '%' GROUP BY category`
				)
				.all(key) as { category: string; spent: number }[]
		).map((r) => [r.category, r.spent])
	);

	const rows: BudgetRow[] = [...budgets].map(([category, monthly]) => {
		const budget = monthly * months;
		const spent = spentByCat.get(category) ?? 0;
		const expected = pace == null ? null : budget * pace;
		// il ritmo conta solo da quando è passato un quinto del periodo: nei primi giorni
		// del mese un singolo acquisto lo farebbe scattare sempre
		const aheadOfPace = expected != null && pace != null && pace >= 0.2 && spent > expected * 1.1;
		const state: BudgetRow['state'] = spent > budget ? 'over' : spent >= budget * 0.9 || aheadOfPace ? 'warn' : 'ok';
		return { category, monthly, budget, spent, pct: spent / budget, expected, state };
	});
	rows.sort((a, b) => b.pct - a.pct);

	return {
		kind,
		key,
		months,
		pace,
		rows,
		totalBudget: rows.reduce((s, r) => s + r.budget, 0),
		totalSpent: rows.reduce((s, r) => s + r.spent, 0),
		over: rows.filter((r) => r.state === 'over').length
	};
}

export interface BalancePoint {
	date: string;
	value: number; // saldo cumulato (entrate − uscite) a fine giornata
}

/**
 * Saldo cumulato giorno per giorno, dal primo all'ultimo movimento: quanto è stato messo
 * da parte (o speso oltre le entrate) dall'inizio dello storico. Giroconti esclusi salvo
 * categoria scelta, filtri di categoria/card/ricerca applicati; il periodo no, lo sceglie
 * il grafico. I giorni senza movimenti ripetono il saldo: il grafico dispone i punti per
 * indice, quindi servono giorni consecutivi.
 */
export function balanceSeries(transfers: Set<string>, f: ExpenseFilters): BalancePoint[] {
	const { where, params } = nonTransferConditions(transfers, f, false);
	const rows = db
		.prepare(
			`SELECT date, SUM(amount) AS net FROM expenses
			 ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
			 GROUP BY date ORDER BY date`
		)
		.all(...params) as { date: string; net: number }[];
	if (rows.length === 0) return [];

	const netByDate = new Map(rows.map((r) => [r.date, r.net]));
	const end = rows[rows.length - 1].date;
	const out: BalancePoint[] = [];
	let cum = 0;
	for (const d = new Date(rows[0].date + 'T00:00:00Z'); ; d.setUTCDate(d.getUTCDate() + 1)) {
		const date = d.toISOString().slice(0, 10);
		cum += netByDate.get(date) ?? 0;
		out.push({ date, value: Math.round(cum * 100) / 100 });
		if (date >= end) break;
	}
	return out;
}

// ---------- Query dashboard ----------

const notTransferSql = (transfers: Set<string>) =>
	transfers.size > 0
		? `AND category NOT IN (${[...transfers].map(() => '?').join(',')})`
		: '';

export interface InOut {
	label: string; // anno YYYY o mese YYYY-MM
	moneyIn: number;
	moneyOut: number; // positivo
}

export function yearlyInOut(transfers: Set<string>): InOut[] {
	const t = [...transfers];
	return db
		.prepare(
			`SELECT substr(date, 1, 4) AS label,
				SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS moneyIn,
				SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS moneyOut
			 FROM expenses WHERE 1=1 ${notTransferSql(transfers)}
			 GROUP BY label ORDER BY label`
		)
		.all(...t) as InOut[];
}

export function monthlyInOut(year: string, transfers: Set<string>): InOut[] {
	const t = [...transfers];
	return db
		.prepare(
			`SELECT substr(date, 1, 7) AS label,
				SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS moneyIn,
				SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS moneyOut
			 FROM expenses WHERE substr(date, 1, 4) = ? ${notTransferSql(transfers)}
			 GROUP BY label ORDER BY label`
		)
		.all(year, ...t) as InOut[];
}

export interface CategoryTotal {
	category: string;
	moneyOut: number; // uscite (positivo)
	moneyIn: number;
	count: number;
}

/** Totali per categoria in un periodo (prefix ISO: "2026" o "2026-03"). Include i transfer (filtrati in UI). */
export function categoryTotals(prefix: string): CategoryTotal[] {
	return db
		.prepare(
			`SELECT category,
				SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS moneyOut,
				SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS moneyIn,
				COUNT(*) AS count
			 FROM expenses WHERE date LIKE ? || '%'
			 GROUP BY category ORDER BY moneyOut DESC`
		)
		.all(prefix) as CategoryTotal[];
}

export interface CategorySummary {
	category: string;
	count: number;
	moneyOut: number;
	moneyIn: number;
	first: string;
	last: string;
}

export function categorySummaries(): CategorySummary[] {
	return db
		.prepare(
			`SELECT category, COUNT(*) AS count,
				SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS moneyOut,
				SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS moneyIn,
				MIN(date) AS first, MAX(date) AS last
			 FROM expenses GROUP BY category ORDER BY moneyOut DESC`
		)
		.all() as CategorySummary[];
}

export function distinctCards(): string[] {
	return (db.prepare('SELECT DISTINCT card FROM expenses ORDER BY card').all() as { card: string }[]).map((r) => r.card);
}

export interface CardUsage {
	card: string;
	count: number;
	first: string;
	last: string;
}

/** Valori distinti del campo `card` con quante spese li usano: serve al pannello di
 *  normalizzazione in /admin (gli export bancari producono varianti di battitura). */
export function cardUsage(): CardUsage[] {
	return db
		.prepare(
			`SELECT card, COUNT(*) AS count, MIN(date) AS first, MAX(date) AS last
			 FROM expenses GROUP BY card ORDER BY count DESC, card`
		)
		.all() as CardUsage[];
}

/** Rinomina un valore `card` su tutte le spese. Rinominare verso un valore già
 *  esistente **unisce** le due varianti: è il modo di accorpare `bancomatAlfa` in
 *  `BancomatAlfa`. Ritorna le righe toccate. */
export function renameCard(from: string, to: string): number {
	const info = db.prepare('UPDATE expenses SET card = ? WHERE card = ?').run(to, from);
	if (info.changes > 0) log('spese', `card "${from}" → "${to}" su ${info.changes} spese`);
	return info.changes;
}

export interface CardTotal {
	card: string;
	moneyOut: number;
	moneyIn: number;
	count: number;
}

/** Totali per valore `card` nel periodo (prefix ISO "2026" / "2026-03", '' = tutto).
 *  Raggruppa sul valore grezzo: il roll-up sulle card configurate avviene in UI con
 *  `cardGroupLabel`, così la regola di abbinamento resta una sola. */
export function cardTotals(prefix: string, transfers: Set<string>): CardTotal[] {
	const t = [...transfers];
	return db
		.prepare(
			`SELECT card,
				SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS moneyOut,
				SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS moneyIn,
				COUNT(*) AS count
			 FROM expenses WHERE date LIKE ? || '%' ${notTransferSql(transfers)}
			 GROUP BY card ORDER BY moneyOut DESC`
		)
		.all(prefix, ...t) as CardTotal[];
}

/** Andamento di una singola categoria: per anno se `year` è vuoto, altrimenti per
 *  mese dentro quell'anno. Etichette nello stesso formato di yearlyInOut/monthlyInOut. */
export function categoryTrend(category: string, year: string): InOut[] {
	if (year) {
		return db
			.prepare(
				`SELECT substr(date, 1, 7) AS label,
					SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS moneyIn,
					SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS moneyOut
				 FROM expenses WHERE category = ? AND substr(date, 1, 4) = ?
				 GROUP BY label ORDER BY label`
			)
			.all(category, year) as InOut[];
	}
	return db
		.prepare(
			`SELECT substr(date, 1, 4) AS label,
				SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS moneyIn,
				SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS moneyOut
			 FROM expenses WHERE category = ?
			 GROUP BY label ORDER BY label`
		)
		.all(category) as InOut[];
}

/** Quante spese hanno una categoria vera e quante sono ancora `unknown` nel periodo.
 *  Le statistiche per categoria sono incomplete di quella quota, quindi va detto. */
export function coverage(prefix: string): { total: number; unknown: number } {
	return db
		.prepare(
			`SELECT COUNT(*) AS total,
				SUM(CASE WHEN category = 'unknown' THEN 1 ELSE 0 END) AS unknown
			 FROM expenses WHERE date LIKE ? || '%'`
		)
		.get(prefix) as { total: number; unknown: number };
}

/** Mesi distinti con almeno una spesa nel periodo: denominatore delle medie mensili. */
export function monthsInPeriod(prefix: string): number {
	return (
		db
			.prepare(
				`SELECT COUNT(DISTINCT substr(date, 1, 7)) AS n FROM expenses WHERE date LIKE ? || '%'`
			)
			.get(prefix) as { n: number }
	).n;
}

export interface Recurring {
	label: string; // descrizione rappresentativa (la più frequente del gruppo)
	months: number; // mesi distinti in cui compare
	amount: number; // importo mediano (uscita, positivo)
	yearly: number; // stima annua = mediana × 12
	first: string;
	last: string;
	active: boolean; // visto negli ultimi 90 giorni
	periodCount: number; // addebiti nel periodo dei filtri (tutto lo storico se nessuno)
	periodTotal: number; // uscite nel periodo dei filtri (positivo)
}

/** Chiave di raggruppamento di una descrizione bancaria: minuscolo, spazi normalizzati,
 *  via i token che contengono cifre (numeri di esercente, riferimenti, date) che
 *  altrimenti renderebbero unica ogni occorrenza. Troncata: la coda delle descrizioni
 *  bancarie è quasi sempre rumore. */
function recurringKey(description: string): string {
	return description
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w !== '' && !/\d/.test(w))
		.join(' ')
		.slice(0, 40);
}

const median = (xs: number[]): number => {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Uscite che sembrano ricorrenti (abbonamenti, utenze, rate).
 *
 * **Euristica, da rileggere**: raggruppa le uscite per descrizione normalizzata e tiene
 * i gruppi che compaiono in almeno `minMonths` mesi distinti e con importo stabile (almeno
 * tre quarti delle occorrenze entro ±15% dalla mediana). La stabilità dell'importo è il
 * segnale che distingue un abbonamento da una spesa ripetuta ma variabile (la spesa
 * al supermercato ricorre ogni mese ma di importo diverso).
 *
 * Filtri: categoria, card e ricerca restringono le uscite su cui si cerca la ricorrenza,
 * che però si cerca su **tutto lo storico** (in un solo mese nulla è ricorrente). Il
 * periodo sceglie invece quali mostrare: quelle con almeno un addebito nel periodo, con
 * conteggio e totale del periodo.
 */
export function recurring(transfers: Set<string>, filters: ExpenseFilters = NO_FILTERS, minMonths = 4): Recurring[] {
	const { where, params } = nonTransferConditions(transfers, filters, false);
	where.push('amount < 0');
	const rows = db
		.prepare(`SELECT date, description, -amount AS out FROM expenses WHERE ${where.join(' AND ')}`)
		.all(...params) as { date: string; description: string; out: number }[];

	const groups = new Map<
		string,
		{
			amounts: number[];
			months: Set<string>;
			descs: Map<string, number>;
			first: string;
			last: string;
			periodCount: number;
			periodTotal: number;
		}
	>();
	for (const r of rows) {
		const k = recurringKey(r.description);
		if (k === '') continue;
		let g = groups.get(k);
		if (!g) {
			g = { amounts: [], months: new Set(), descs: new Map(), first: r.date, last: r.date, periodCount: 0, periodTotal: 0 };
			groups.set(k, g);
		}
		g.amounts.push(r.out);
		g.months.add(r.date.slice(0, 7));
		g.descs.set(r.description, (g.descs.get(r.description) ?? 0) + 1);
		if (r.date < g.first) g.first = r.date;
		if (r.date > g.last) g.last = r.date;
		if (inPeriod(filters, r.date)) {
			g.periodCount++;
			g.periodTotal += r.out;
		}
	}

	const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const out: Recurring[] = [];
	for (const g of groups.values()) {
		if (g.months.size < minMonths || g.periodCount === 0) continue;
		const med = median(g.amounts);
		if (med <= 0) continue;
		const stable = g.amounts.filter((a) => Math.abs(a - med) <= med * 0.15).length;
		if (stable / g.amounts.length < 0.75) continue;
		const label = [...g.descs.entries()].sort((a, b) => b[1] - a[1])[0][0];
		out.push({
			label,
			months: g.months.size,
			amount: med,
			yearly: med * 12,
			first: g.first,
			last: g.last,
			active: g.last >= cutoff,
			periodCount: g.periodCount,
			periodTotal: g.periodTotal
		});
	}
	return out.sort((a, b) => Number(b.active) - Number(a.active) || b.amount - a.amount);
}

export function expenseYears(): string[] {
	return (
		db.prepare('SELECT DISTINCT substr(date, 1, 4) AS y FROM expenses ORDER BY y DESC').all() as { y: string }[]
	).map((r) => r.y);
}

// ---------- Regole sulle voci esistenti: ricategorizzazione e conflitti ----------

export interface RulesRunPreview {
	unknown: number; // voci senza categoria (non bloccate)
	matched: number; // quante le regole attuali saprebbero categorizzare
	byCategory: { category: string; count: number }[];
}

/** Applica le regole alle voci `unknown` non bloccate. Con `apply=false` calcola
 *  solo l'anteprima. Le voci bloccate a mano (category_manual=1) non si toccano mai. */
export function runRulesOnUnknown(apply: boolean): RulesRunPreview & { applied: number } {
	const { rules } = loadRules();
	const unknowns = db
		.prepare("SELECT id, description FROM expenses WHERE category = 'unknown' AND category_manual = 0")
		.all() as { id: number; description: string }[];
	const matches: { id: number; category: string }[] = [];
	const byCategory = new Map<string, number>();
	for (const u of unknowns) {
		const m = matchCategory(u.description, rules);
		if (m) {
			matches.push({ id: u.id, category: m.category });
			byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
		}
	}
	let applied = 0;
	if (apply && matches.length > 0) {
		const upd = db.prepare("UPDATE expenses SET category = ? WHERE id = ? AND category = 'unknown' AND category_manual = 0");
		db.transaction(() => {
			for (const m of matches) applied += upd.run(m.category, m.id).changes;
		})();
		log('spese', `regole applicate alle voci senza categoria: ${applied} categorizzate`);
	}
	return {
		unknown: unknowns.length,
		matched: matches.length,
		byCategory: [...byCategory.entries()]
			.map(([category, count]) => ({ category, count }))
			.sort((a, b) => b.count - a.count),
		applied
	};
}

export interface ConflictItem {
	id: number;
	date: string;
	description: string;
	card: string;
	amount: number;
	category: string; // categoria attuale della voce
	ruleCategory: string; // categoria che le regole assegnerebbero
	keyword: string; // keyword che ha deciso
	manual: boolean;
}

export interface ConflictGroup {
	category: string;
	ruleCategory: string;
	count: number;
	keywords: string[]; // keyword coinvolte, le più frequenti prima
	items: ConflictItem[]; // ordinate per data decrescente
}

/**
 * Voci con una categoria (non `unknown`) diversa da quella che le regole attuali
 * assegnerebbero. `locked=false` → da rivedere (non bloccate); `locked=true` → le
 * decisioni già prese a mano, per rivederle o sbloccarle.
 *
 * Nota: lo storico categorizzato prima del flag manuale non distingue tra scelta a
 * mano e categoria ereditata dal vecchio script, quindi all'inizio può comparire
 * molto: si smaltisce a gruppi con "applica regola" o "tieni la mia".
 */
export function findConflicts(locked: boolean): ConflictGroup[] {
	const { rules } = loadRules();
	if (rules.length === 0) return [];
	const rows = db
		.prepare(
			`SELECT id, date, description, card, amount, category FROM expenses
			 WHERE category != 'unknown' AND category_manual = ?
			 ORDER BY date DESC, id DESC`
		)
		.all(locked ? 1 : 0) as Omit<ConflictItem, 'ruleCategory' | 'keyword' | 'manual'>[];

	const groups = new Map<string, ConflictGroup & { kwCount: Map<string, number> }>();
	for (const r of rows) {
		const m = matchCategory(r.description, rules);
		if (!m || m.category === r.category) continue;
		const key = `${r.category}\u0000${m.category}`;
		let g = groups.get(key);
		if (!g) {
			g = { category: r.category, ruleCategory: m.category, count: 0, keywords: [], items: [], kwCount: new Map() };
			groups.set(key, g);
		}
		g.count++;
		g.kwCount.set(m.keyword, (g.kwCount.get(m.keyword) ?? 0) + 1);
		g.items.push({ ...r, ruleCategory: m.category, keyword: m.keyword, manual: locked });
	}
	return [...groups.values()]
		.map(({ kwCount, ...g }) => ({
			...g,
			keywords: [...kwCount.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
		}))
		.sort((a, b) => b.count - a.count);
}

/** Totale conflitti da rivedere (per badge e avvisi). */
export function conflictCount(): number {
	return findConflicts(false).reduce((s, g) => s + g.count, 0);
}

export type RuleFromMovementResult =
	| { ok: true; keyword: string; applied: number; newConflicts: number }
	| { ok: false; error: string };

/**
 * "Crea regola da questa voce": aggiunge una keyword presa dalla descrizione di un
 * movimento a una categoria e, se richiesto, rilancia le regole sulle voci senza
 * categoria. Riporta i conflitti nati (voci già categorizzate altrove che la nuova
 * keyword assegnerebbe a un'altra categoria), contati come nella pagina Conflitti.
 */
export function createRuleFromMovement(id: number, keywordRaw: string, category: string, apply: boolean): RuleFromMovementResult {
	const m = db.prepare('SELECT description FROM expenses WHERE id = ?').get(id) as { description: string } | undefined;
	if (!m) return { ok: false, error: 'Voce inesistente.' };
	const keyword = keywordRaw.trim().toLowerCase();
	if (keyword.length < 3)
		return { ok: false, error: 'Keyword troppo corta (almeno 3 caratteri): catturerebbe voci a caso.' };
	if (!m.description.toLowerCase().includes(keyword))
		return { ok: false, error: `"${keyword}" non compare nella descrizione: la regola non riconoscerebbe questa voce.` };

	const before = conflictCount();
	const res = addKeyword(category, keyword);
	if (!res.ok) return { ok: false, error: res.error };
	const applied = apply ? runRulesOnUnknown(true).applied : 0;
	const newConflicts = Math.max(0, conflictCount() - before);
	log('spese', `regola da voce ${id}: "${keyword}" → ${category}, ${applied} voci categorizzate, ${newConflicts} nuovi conflitti`);
	return { ok: true, keyword, applied, newConflicts };
}

/**
 * Risolve conflitti. `accept` = applica la categoria delle regole (e sblocca);
 * `keep` = tieni la tua e bloccala; `unlock` = togli il blocco senza cambiare categoria.
 * Il bersaglio è un singolo id oppure un intero gruppo (categoria attuale → regola),
 * ricalcolato qui così da toccare solo le voci ancora in conflitto.
 */
export function resolveConflicts(
	action: 'accept' | 'keep' | 'unlock',
	target: { id: number } | { category: string; ruleCategory: string; locked: boolean }
): number {
	const items =
		'id' in target
			? [...findConflicts(false), ...findConflicts(true)].flatMap((g) => g.items).filter((i) => i.id === target.id)
			: findConflicts(target.locked)
					.filter((g) => g.category === target.category && g.ruleCategory === target.ruleCategory)
					.flatMap((g) => g.items);
	if (items.length === 0) return 0;
	const accept = db.prepare('UPDATE expenses SET category = ?, category_manual = 0 WHERE id = ?');
	const lock = db.prepare('UPDATE expenses SET category_manual = 1 WHERE id = ?');
	const unlock = db.prepare('UPDATE expenses SET category_manual = 0 WHERE id = ?');
	let n = 0;
	db.transaction(() => {
		for (const i of items) {
			if (action === 'accept') n += accept.run(i.ruleCategory, i.id).changes;
			else if (action === 'keep') n += lock.run(i.id).changes;
			else n += unlock.run(i.id).changes;
		}
	})();
	log('spese', `conflitti: ${action} su ${n} voci`);
	return n;
}

/** Statistiche d'uso per categoria, incluse quelle usate dalle spese ma non definite. */
export function categoryUsage(): Map<string, { count: number; out: number; last: string | null }> {
	const rows = db
		.prepare(
			`SELECT category, COUNT(*) AS count, SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS out, MAX(date) AS last
			 FROM expenses GROUP BY category`
		)
		.all() as { category: string; count: number; out: number; last: string | null }[];
	return new Map(rows.map((r) => [r.category, { count: r.count, out: r.out, last: r.last }]));
}
