/**
 * Motore di categorizzazione spese basato su file di testo.
 *
 * `DATA_DIR/categories.json` — fonte di verità delle regole, formato invariato
 * rispetto allo script Python storico: { "categoria": ["keyword", ...] }.
 * Match: substring case-insensitive sulla descrizione; vince la keyword più lunga
 * (a parità, la prima nell'ordine del file). Riletto a ogni uso: editing a mano
 * senza riavvii.
 *
 * `DATA_DIR/categories-meta.json` — proprietà per categoria gestite dalla UI
 * (icona, colore, flag giroconto), comunque editabile a mano:
 * { "spese_auto": { "icon": "car", "color": "#aabbcc", "transfer": false } }
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db';

export interface CategoryRule {
	keyword: string;
	category: string;
}

export interface RulesFile {
	rules: CategoryRule[]; // appiattite, in ordine di file
	categories: string[]; // ordine di file
	warnings: string[]; // keyword sospette (sintassi regex: mai matchate come substring)
	error: string | null; // file mancante/illeggibile/malformato
}

export const RULES_PATH = () => path.join(DATA_DIR, 'categories.json');
export const META_PATH = () => path.join(DATA_DIR, 'categories-meta.json');

const SUSPICIOUS = /[[\]()?*+|^$\\]/;

export function loadRules(): RulesFile {
	const out: RulesFile = { rules: [], categories: [], warnings: [], error: null };
	let raw: string;
	try {
		raw = fs.readFileSync(RULES_PATH(), 'utf-8');
	} catch {
		out.error = `File regole non trovato (${RULES_PATH()}): le righe senza categoria resteranno "unknown".`;
		return out;
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (e) {
		out.error = `categories.json non è JSON valido: ${String(e)}`;
		return out;
	}
	if (typeof json !== 'object' || json === null || Array.isArray(json)) {
		out.error = 'categories.json deve essere un oggetto { "categoria": ["keyword", …] }.';
		return out;
	}
	for (const [category, keywords] of Object.entries(json)) {
		if (!Array.isArray(keywords)) {
			out.warnings.push(`Categoria "${category}": valore non è una lista, ignorata.`);
			continue;
		}
		out.categories.push(category);
		for (const kw of keywords) {
			if (typeof kw !== 'string' || kw.trim() === '') continue;
			out.rules.push({ keyword: kw, category });
			if (SUSPICIOUS.test(kw))
				out.warnings.push(
					`Keyword "${kw}" (${category}) contiene metacaratteri regex: il match è substring letterale, probabilmente non matcherà mai.`
				);
		}
	}
	return out;
}

/** Match dello script Python: substring case-insensitive, keyword più lunga vince. */
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

export interface CategoryMeta {
	icon?: string;
	color?: string;
	transfer?: boolean;
}

export type MetaFile = Record<string, CategoryMeta>;

export function loadMeta(): MetaFile {
	try {
		const json = JSON.parse(fs.readFileSync(META_PATH(), 'utf-8'));
		return typeof json === 'object' && json !== null && !Array.isArray(json) ? json : {};
	} catch {
		return {};
	}
}

export function saveMeta(meta: MetaFile) {
	fs.writeFileSync(META_PATH(), JSON.stringify(meta, null, 2) + '\n');
}

export function transferCategories(meta: MetaFile = loadMeta()): Set<string> {
	return new Set(Object.entries(meta).filter(([, m]) => m.transfer).map(([name]) => name));
}

/** Rinomina una categoria in categories.json (chiave) preservando l'ordine; no-op se assente. */
export function renameCategoryInRules(oldName: string, newName: string): boolean {
	let raw: string;
	try {
		raw = fs.readFileSync(RULES_PATH(), 'utf-8');
	} catch {
		return false;
	}
	let json: Record<string, unknown>;
	try {
		json = JSON.parse(raw);
	} catch {
		return false;
	}
	if (!(oldName in json)) return false;
	const renamed: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(json)) renamed[k === oldName ? newName : k] = v;
	fs.writeFileSync(RULES_PATH(), JSON.stringify(renamed, null, 4) + '\n');
	return true;
}
