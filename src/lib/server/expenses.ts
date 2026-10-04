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
 */
export function recurring(transfers: Set<string>, minMonths = 4): Recurring[] {
	const t = [...transfers];
	const rows = db
		.prepare(
			`SELECT date, description, -amount AS out FROM expenses
			 WHERE amount < 0 ${notTransferSql(transfers)}`
		)
		.all(...t) as { date: string; description: string; out: number }[];

	const groups = new Map<
		string,
		{ amounts: number[]; months: Set<string>; descs: Map<string, number>; first: string; last: string }
	>();
	for (const r of rows) {
		const k = recurringKey(r.description);
		if (k === '') continue;
		let g = groups.get(k);
		if (!g) {
			g = { amounts: [], months: new Set(), descs: new Map(), first: r.date, last: r.date };
			groups.set(k, g);
		}
		g.amounts.push(r.out);
		g.months.add(r.date.slice(0, 7));
		g.descs.set(r.description, (g.descs.get(r.description) ?? 0) + 1);
		if (r.date < g.first) g.first = r.date;
		if (r.date > g.last) g.last = r.date;
	}

	const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
	const out: Recurring[] = [];
	for (const g of groups.values()) {
		if (g.months.size < minMonths) continue;
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
			active: g.last >= cutoff
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
