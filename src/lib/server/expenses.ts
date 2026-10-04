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
import { createBackup } from './backup';
import { loadRules, matchCategory } from './categorize';
import { db, type Expense } from './db';
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

export function expenseYears(): string[] {
	return (
		db.prepare('SELECT DISTINCT substr(date, 1, 4) AS y FROM expenses ORDER BY y DESC').all() as { y: string }[]
	).map((r) => r.y);
}
