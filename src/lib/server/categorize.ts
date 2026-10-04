/**
 * Categorie delle spese e regole di categorizzazione, su database.
 *
 * Tabelle `expense_categories` (nome, icona, colore, flag giroconto, ordine) ed
 * `expense_keywords` (una keyword appartiene a una sola categoria). Gestite dalla UI
 * in Amministrazione → Categorie; il JSON serve solo per import iniziale ed export.
 *
 * Match (stessa semantica dello script Python storico): substring senza maiuscole
 * sulla descrizione, vince la keyword più lunga; a parità vince la categoria che
 * viene prima nell'ordine, poi la keyword inserita prima.
 *
 * Migrazione: fino al 2026-10 le regole stavano in `DATA_DIR/categories.json` e le
 * proprietà in `categories-meta.json`. Al primo accesso, se il DB non è ancora la
 * fonte (`settings.categories_source`), quei file vengono importati una volta.
 * Ripristinare un backup di prima della migrazione riporta i settings senza il flag
 * e i json abbinati al backup, quindi l'import si ripete coerente con quel backup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, db, getSetting, setSetting } from './db';
import { log } from './log';
import { STARTER_CATEGORIES } from './starter-categories';

export interface CategoryRule {
	keyword: string;
	category: string;
}

export interface RulesFile {
	rules: CategoryRule[]; // in ordine: categoria (position), poi keyword (inserimento)
	categories: string[];
	warnings: string[]; // keyword sospette (sintassi regex: il match è letterale)
	error: string | null; // conservato per compatibilità: con il DB è sempre null
}

export interface CategoryMeta {
	icon?: string;
	color?: string;
	transfer?: boolean;
}

export type MetaFile = Record<string, CategoryMeta>;

/** Formato JSON di import/export. Il valore può essere la sola lista di keyword
 *  (formato storico di categories.json) o un oggetto con keyword e proprietà. */
export type CategoriesJson = Record<
	string,
	string[] | { keywords?: string[]; icon?: string | null; color?: string | null; transfer?: boolean }
>;

export interface CategoryDef {
	name: string;
	icon: string | null;
	color: string | null;
	transfer: boolean;
	position: number;
	keywords: { id: number; keyword: string }[];
}

/** Nome riservato: le voci senza categoria. Non è una categoria definibile. */
export const UNKNOWN = 'unknown';

export const RULES_PATH = () => path.join(DATA_DIR, 'categories.json');
export const META_PATH = () => path.join(DATA_DIR, 'categories-meta.json');

const SUSPICIOUS = /[[\]()?*+|^$\\]/;

// ---------------------------------------------------------------- migrazione

/** Importa una volta i vecchi categories.json / categories-meta.json. Su un'installazione
 *  vuota (nessuna categoria, nessun file, nessuna spesa) carica il set suggerito. */
export function ensureCategoriesMigrated() {
	if (getSetting('categories_source') === 'db') return;
	const count = (db.prepare('SELECT COUNT(*) AS c FROM expense_categories').get() as { c: number }).c;
	if (count === 0) {
		const legacy = readLegacyJson();
		if (legacy) {
			const res = importCategories(legacy, 'merge');
			log(
				'spese',
				`categorie migrate dai file json: ${res.categoriesAdded} categorie, ${res.keywordsAdded} keyword` +
					(res.skipped.length ? `, ${res.skipped.length} keyword scartate (duplicate)` : '')
			);
		} else {
			const hasExpenses = db.prepare('SELECT 1 FROM expenses LIMIT 1').get() !== undefined;
			if (!hasExpenses) {
				importCategories(STARTER_CATEGORIES, 'merge');
				log('spese', 'installazione vuota: caricato il set di categorie suggerito');
			}
		}
	}
	setSetting('categories_source', 'db');
}

/** Unisce categories.json (keyword) e categories-meta.json (proprietà), se presenti. */
function readLegacyJson(): CategoriesJson | null {
	let rules: Record<string, unknown> = {};
	let meta: Record<string, CategoryMeta> = {};
	let found = false;
	try {
		const j = JSON.parse(fs.readFileSync(RULES_PATH(), 'utf-8'));
		if (j && typeof j === 'object' && !Array.isArray(j)) {
			rules = j;
			found = true;
		}
	} catch (e) {
		if (fs.existsSync(RULES_PATH())) log('spese', `categories.json illeggibile, non migrato: ${String(e)}`);
	}
	try {
		const j = JSON.parse(fs.readFileSync(META_PATH(), 'utf-8'));
		if (j && typeof j === 'object' && !Array.isArray(j)) {
			meta = j;
			found = true;
		}
	} catch {
		/* assente */
	}
	if (!found) return null;
	const out: CategoriesJson = {};
	for (const name of new Set([...Object.keys(rules), ...Object.keys(meta)])) {
		const kws = rules[name];
		const m = meta[name] ?? {};
		out[name] = {
			keywords: Array.isArray(kws) ? kws.filter((k): k is string => typeof k === 'string') : [],
			icon: m.icon ?? null,
			color: m.color ?? null,
			transfer: !!m.transfer
		};
	}
	return out;
}

// ---------------------------------------------------------------- lettura

export function listCategoryDefs(): CategoryDef[] {
	ensureCategoriesMigrated();
	const cats = db
		.prepare('SELECT name, icon, color, transfer, position FROM expense_categories ORDER BY position, name')
		.all() as { name: string; icon: string | null; color: string | null; transfer: number; position: number }[];
	const kws = db
		.prepare('SELECT id, category, keyword FROM expense_keywords ORDER BY id')
		.all() as { id: number; category: string; keyword: string }[];
	const byCat = new Map<string, { id: number; keyword: string }[]>();
	for (const k of kws) {
		const list = byCat.get(k.category) ?? [];
		list.push({ id: k.id, keyword: k.keyword });
		byCat.set(k.category, list);
	}
	return cats.map((c) => ({
		name: c.name,
		icon: c.icon,
		color: c.color,
		transfer: !!c.transfer,
		position: c.position,
		keywords: byCat.get(c.name) ?? []
	}));
}

export function loadRules(): RulesFile {
	const defs = listCategoryDefs();
	const out: RulesFile = { rules: [], categories: [], warnings: [], error: null };
	for (const d of defs) {
		out.categories.push(d.name);
		for (const k of d.keywords) {
			out.rules.push({ keyword: k.keyword, category: d.name });
			if (SUSPICIOUS.test(k.keyword))
				out.warnings.push(
					`Keyword "${k.keyword}" (${d.name}) contiene metacaratteri regex: il match è substring letterale, probabilmente non matcherà mai.`
				);
		}
	}
	return out;
}

/** Substring senza maiuscole, keyword più lunga vince (a parità la prima in ordine). */
export function matchCategory(
	description: string,
	rules: CategoryRule[]
): { category: string; keyword: string } | null {
	const desc = description.toLowerCase();
	let best: CategoryRule | null = null;
	for (const r of rules) {
		if (r.keyword.length > (best?.keyword.length ?? 0) && desc.includes(r.keyword.toLowerCase()))
			best = r;
	}
	return best ? { category: best.category, keyword: best.keyword } : null;
}

/** Proprietà per categoria, nella forma usata da dashboard e liste. */
export function loadMeta(): MetaFile {
	const out: MetaFile = {};
	for (const d of listCategoryDefs()) {
		out[d.name] = {
			...(d.icon ? { icon: d.icon } : {}),
			...(d.color ? { color: d.color } : {}),
			...(d.transfer ? { transfer: true } : {})
		};
	}
	return out;
}

export function transferCategories(meta: MetaFile = loadMeta()): Set<string> {
	return new Set(Object.entries(meta).filter(([, m]) => m.transfer).map(([name]) => name));
}

// ---------------------------------------------------------------- scrittura

type Result = { ok: true } | { ok: false; error: string };

function validName(raw: string): string | { error: string } {
	const name = raw.trim();
	if (!name) return { error: 'Nome categoria vuoto.' };
	if (name.length > 60) return { error: 'Nome categoria troppo lungo (max 60).' };
	if (name.toLowerCase() === UNKNOWN) return { error: `"${UNKNOWN}" è riservato alle voci senza categoria.` };
	return name;
}

const categoryExists = (name: string) =>
	db.prepare('SELECT 1 FROM expense_categories WHERE name = ?').get(name) !== undefined;

export function createCategory(
	rawName: string,
	meta: { icon?: string | null; color?: string | null; transfer?: boolean } = {}
): Result {
	ensureCategoriesMigrated();
	const name = validName(rawName);
	if (typeof name !== 'string') return { ok: false, error: name.error };
	if (categoryExists(name)) return { ok: false, error: `La categoria "${name}" esiste già.` };
	const pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM expense_categories').get() as { p: number }).p;
	db.prepare('INSERT INTO expense_categories (name, icon, color, transfer, position) VALUES (?, ?, ?, ?, ?)').run(
		name,
		meta.icon || null,
		meta.color || null,
		meta.transfer ? 1 : 0,
		pos
	);
	return { ok: true };
}

export function updateCategoryMeta(
	name: string,
	patch: { icon?: string | null; color?: string | null; transfer?: boolean }
): Result {
	if (!categoryExists(name)) return { ok: false, error: `Categoria "${name}" non definita.` };
	const sets: string[] = [];
	const params: unknown[] = [];
	if (patch.icon !== undefined) {
		sets.push('icon = ?');
		params.push(patch.icon || null);
	}
	if (patch.color !== undefined) {
		sets.push('color = ?');
		params.push(patch.color || null);
	}
	if (patch.transfer !== undefined) {
		sets.push('transfer = ?');
		params.push(patch.transfer ? 1 : 0);
	}
	if (sets.length > 0) db.prepare(`UPDATE expense_categories SET ${sets.join(', ')} WHERE name = ?`).run(...params, name);
	return { ok: true };
}

/**
 * Rinomina una categoria su definizione, keyword e spese. Se il nuovo nome esiste già
 * le due categorie vengono **unite**: le keyword passano alla destinazione, le proprietà
 * della destinazione restano (quelle mancanti vengono prese dall'origine). Funziona
 * anche per categorie usate dalle spese ma non definite.
 */
export function renameCategory(
	oldName: string,
	rawNew: string
): { ok: true; expenses: number; merged: boolean; keywordsMoved: number } | { ok: false; error: string } {
	ensureCategoriesMigrated();
	const newName = validName(rawNew);
	if (typeof newName !== 'string') return { ok: false, error: newName.error };
	if (newName === oldName) return { ok: false, error: 'Il nuovo nome è uguale al vecchio.' };

	return db.transaction(() => {
		const oldDefined = categoryExists(oldName);
		const newDefined = categoryExists(newName);
		let keywordsMoved = 0;
		if (oldDefined && newDefined) {
			keywordsMoved = db.prepare('UPDATE expense_keywords SET category = ? WHERE category = ?').run(newName, oldName).changes;
			const o = db.prepare('SELECT icon, color, transfer FROM expense_categories WHERE name = ?').get(oldName) as {
				icon: string | null;
				color: string | null;
				transfer: number;
			};
			db.prepare(
				'UPDATE expense_categories SET icon = COALESCE(icon, ?), color = COALESCE(color, ?) WHERE name = ?'
			).run(o.icon, o.color, newName);
			db.prepare('DELETE FROM expense_categories WHERE name = ?').run(oldName);
		} else if (oldDefined) {
			// ON UPDATE CASCADE porta con sé le keyword
			db.prepare('UPDATE expense_categories SET name = ? WHERE name = ?').run(newName, oldName);
			keywordsMoved = (db.prepare('SELECT COUNT(*) AS c FROM expense_keywords WHERE category = ?').get(newName) as { c: number }).c;
		}
		const expenses = db.prepare('UPDATE expenses SET category = ? WHERE category = ?').run(newName, oldName).changes;
		if (!oldDefined && expenses === 0) return { ok: false as const, error: `Categoria "${oldName}" inesistente.` };
		log('spese', `categoria "${oldName}" → "${newName}"${newDefined ? ' (unita)' : ''}: ${expenses} spese, ${keywordsMoved} keyword`);
		return { ok: true as const, expenses, merged: oldDefined && newDefined, keywordsMoved };
	})();
}

/** Elimina la categoria e le sue keyword. Le spese che la usavano tornano `unknown`
 *  (e perdono il blocco manuale), così una nuova esecuzione delle regole può
 *  ricategorizzarle. */
export function deleteCategory(name: string): { ok: true; expenses: number } | { ok: false; error: string } {
	if (name === UNKNOWN) return { ok: false, error: 'La categoria "unknown" non si elimina.' };
	return db.transaction(() => {
		const defined = db.prepare('DELETE FROM expense_categories WHERE name = ?').run(name).changes > 0;
		const expenses = db
			.prepare('UPDATE expenses SET category = ?, category_manual = 0 WHERE category = ?')
			.run(UNKNOWN, name).changes;
		if (!defined && expenses === 0) return { ok: false as const, error: `Categoria "${name}" inesistente.` };
		log('spese', `categoria "${name}" eliminata: ${expenses} spese tornate unknown`);
		return { ok: true as const, expenses };
	})();
}

export function addKeyword(category: string, raw: string): Result {
	const keyword = raw.trim();
	if (!keyword) return { ok: false, error: 'Keyword vuota.' };
	if (keyword.length > 120) return { ok: false, error: 'Keyword troppo lunga (max 120).' };
	if (!categoryExists(category)) return { ok: false, error: `Categoria "${category}" non definita.` };
	const dup = db.prepare('SELECT category FROM expense_keywords WHERE keyword = ? COLLATE NOCASE').get(keyword) as
		| { category: string }
		| undefined;
	if (dup) return { ok: false, error: `La keyword "${keyword}" è già nella categoria "${dup.category}".` };
	db.prepare('INSERT INTO expense_keywords (category, keyword) VALUES (?, ?)').run(category, keyword);
	return { ok: true };
}

export function removeKeyword(id: number): Result {
	const changes = db.prepare('DELETE FROM expense_keywords WHERE id = ?').run(id).changes;
	return changes > 0 ? { ok: true } : { ok: false, error: 'Keyword inesistente.' };
}

// ---------------------------------------------------------------- import / export JSON

export function parseCategoriesJson(raw: string): { ok: true; data: CategoriesJson } | { ok: false; error: string } {
	let json: unknown;
	try {
		json = JSON.parse(raw.replace(/^﻿/, ''));
	} catch (e) {
		return { ok: false, error: `JSON non valido: ${String(e)}` };
	}
	if (typeof json !== 'object' || json === null || Array.isArray(json))
		return { ok: false, error: 'Il file deve essere un oggetto { "categoria": [keyword…] } o { "categoria": { keywords, icon, transfer } }.' };
	for (const [name, v] of Object.entries(json)) {
		const ok =
			(Array.isArray(v) && v.every((k) => typeof k === 'string')) ||
			(typeof v === 'object' && v !== null && !Array.isArray(v) &&
				(!('keywords' in v) || (Array.isArray((v as { keywords: unknown }).keywords) &&
					((v as { keywords: unknown[] }).keywords).every((k) => typeof k === 'string'))));
		if (!ok) return { ok: false, error: `Categoria "${name}": valore non valido (lista di keyword o oggetto con "keywords").` };
	}
	return { ok: true, data: json as CategoriesJson };
}

export interface ImportReport {
	categoriesAdded: number;
	categoriesUpdated: number;
	keywordsAdded: number;
	skipped: { keyword: string; category: string; reason: string }[];
}

/**
 * Importa categorie e keyword. `merge` aggiunge ciò che manca senza toccare l'esistente
 * (le proprietà vengono impostate solo se assenti); `replace` cancella prima tutte le
 * categorie e keyword. Nessuna delle due modalità tocca le spese.
 */
export function importCategories(data: CategoriesJson, mode: 'merge' | 'replace'): ImportReport {
	const report: ImportReport = { categoriesAdded: 0, categoriesUpdated: 0, keywordsAdded: 0, skipped: [] };
	db.transaction(() => {
		if (mode === 'replace') db.prepare('DELETE FROM expense_categories').run();
		let pos = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM expense_categories').get() as { p: number }).p;
		const insCat = db.prepare('INSERT INTO expense_categories (name, icon, color, transfer, position) VALUES (?, ?, ?, ?, ?)');
		const fillCat = db.prepare(
			'UPDATE expense_categories SET icon = COALESCE(icon, ?), color = COALESCE(color, ?), transfer = MAX(transfer, ?) WHERE name = ?'
		);
		const dupKw = db.prepare('SELECT category FROM expense_keywords WHERE keyword = ? COLLATE NOCASE');
		const insKw = db.prepare('INSERT INTO expense_keywords (category, keyword) VALUES (?, ?)');

		for (const [rawName, v] of Object.entries(data)) {
			const name = rawName.trim();
			if (!name || name.toLowerCase() === UNKNOWN) continue;
			const spec = Array.isArray(v) ? { keywords: v } : v;
			const icon = spec.icon ?? null;
			const color = spec.color ?? null;
			const transfer = spec.transfer ? 1 : 0;
			if (categoryExists(name)) {
				fillCat.run(icon, color, transfer, name);
				report.categoriesUpdated++;
			} else {
				insCat.run(name, icon, color, transfer, pos++);
				report.categoriesAdded++;
			}
			for (const raw of spec.keywords ?? []) {
				const kw = raw.trim();
				if (!kw) continue;
				const dup = dupKw.get(kw) as { category: string } | undefined;
				if (dup) {
					if (dup.category !== name)
						report.skipped.push({ keyword: kw, category: name, reason: `già in "${dup.category}"` });
					continue;
				}
				insKw.run(name, kw);
				report.keywordsAdded++;
			}
		}
	})();
	setSetting('categories_source', 'db');
	return report;
}

/** Export nel formato esteso (keyword + proprietà): reimportabile senza perdite. */
export function exportCategories(): CategoriesJson {
	const out: CategoriesJson = {};
	for (const d of listCategoryDefs()) {
		out[d.name] = {
			keywords: d.keywords.map((k) => k.keyword),
			...(d.icon ? { icon: d.icon } : {}),
			...(d.color ? { color: d.color } : {}),
			...(d.transfer ? { transfer: true } : {})
		};
	}
	return out;
}
