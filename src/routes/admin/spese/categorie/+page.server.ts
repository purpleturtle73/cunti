import { fail } from '@sveltejs/kit';
import { createBackup } from '$lib/server/backup';
import {
	addKeyword,
	createCategory,
	deleteCategory,
	importCategories,
	listCategoryDefs,
	loadRules,
	matchCategory,
	parseCategoriesJson,
	removeKeyword,
	renameCategory,
	UNKNOWN,
	updateCategoryMeta
} from '$lib/server/categorize';
import { db } from '$lib/server/db';
import { categoryUsage, conflictCount, runRulesOnUnknown } from '$lib/server/expenses';
import { log, logError } from '$lib/server/log';
import { STARTER_CATEGORIES } from '$lib/server/starter-categories';
import { CATEGORIES_JSON_MAX_BYTES } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

/** Amministrazione → Spese → Categorie: categorie, keyword, import/export JSON,
 *  ricategorizzazione delle voci senza categoria. */
export const load: PageServerLoad = () => {
	const defs = listCategoryDefs();
	const usage = categoryUsage();
	const defined = new Set(defs.map((d) => d.name));
	// categorie presenti sulle spese ma non definite (es. arrivate da un CSV)
	const undefinedUsed = [...usage.entries()]
		.filter(([name]) => name !== UNKNOWN && !defined.has(name))
		.map(([name, u]) => ({ name, ...u }))
		.sort((a, b) => b.count - a.count);
	return {
		categories: defs.map((d) => ({ ...d, usage: usage.get(d.name) ?? { count: 0, out: 0, last: null } })),
		undefinedUsed,
		unknownRun: runRulesOnUnknown(false),
		conflicts: conflictCount(),
		warnings: loadRules().warnings
	};
};

/** Esito standard: `target` = categoria a cui riferire il messaggio (o '' = in alto). */
const ok = (message: string, target = '') => ({ section: 'cat', target, message });
const ko = (error: string, target = '') => fail(400, { section: 'cat', target, error });

export const actions: Actions = {
	createCategory: async ({ request }) => {
		const f = await request.formData();
		const name = String(f.get('name') || '');
		const res = createCategory(name, {
			icon: String(f.get('icon') || '') || null,
			transfer: f.get('transfer') === '1'
		});
		return res.ok ? ok(`Categoria "${name.trim()}" creata.`) : ko(res.error);
	},

	updateMeta: async ({ request }) => {
		const f = await request.formData();
		const name = String(f.get('name') || '');
		const res = updateCategoryMeta(name, {
			icon: String(f.get('icon') || '') || null,
			transfer: f.get('transfer') === '1'
		});
		return res.ok ? ok('Salvato.', name) : ko(res.error, name);
	},

	renameCategory: async ({ request }) => {
		const f = await request.formData();
		const oldName = String(f.get('old') || '');
		const newName = String(f.get('new') || '');
		const res = renameCategory(oldName, newName);
		if (!res.ok) return ko(res.error, oldName);
		return ok(
			`"${oldName}" → "${newName.trim()}"${res.merged ? ' (unite)' : ''}: ${res.expenses} spese, ${res.keywordsMoved} keyword.`,
			newName.trim()
		);
	},

	deleteCategory: async ({ request }) => {
		const f = await request.formData();
		const name = String(f.get('name') || '');
		const res = deleteCategory(name);
		return res.ok
			? ok(`Categoria "${name}" eliminata: ${res.expenses} spese tornate senza categoria.`)
			: ko(res.error, name);
	},

	addKeyword: async ({ request }) => {
		const f = await request.formData();
		const category = String(f.get('category') || '');
		const res = addKeyword(category, String(f.get('keyword') || ''));
		return res.ok ? ok('Keyword aggiunta.', category) : ko(res.error, category);
	},

	removeKeyword: async ({ request }) => {
		const f = await request.formData();
		const res = removeKeyword(Number(f.get('id')));
		return res.ok ? ok('Keyword rimossa.', String(f.get('category') || '')) : ko(res.error);
	},

	runRules: async () => {
		const res = runRulesOnUnknown(true);
		return ok(`${res.applied} voci senza categoria categorizzate dalle regole.`);
	},

	importJson: async ({ request }) => {
		const f = await request.formData();
		const file = f.get('file');
		const mode = f.get('mode') === 'replace' ? 'replace' : 'merge';
		if (!(file instanceof File) || file.size === 0) return ko('Seleziona un file JSON.');
		if (file.size > CATEGORIES_JSON_MAX_BYTES) return ko('File troppo grande (max 1 MB).');
		const parsed = parseCategoriesJson(await file.text());
		if (!parsed.ok) return ko(parsed.error);
		if (mode === 'replace') {
			// sostituire cancella tutte le categorie e keyword: prima un backup
			try {
				await createBackup();
			} catch (e) {
				logError('spese', 'backup prima della sostituzione categorie fallito', e);
				return ko(`Backup fallito, categorie non sostituite: ${String(e)}`);
			}
		}
		const rep = importCategories(parsed.data, mode);
		log('spese', `import categorie (${mode}) da "${file.name}": +${rep.categoriesAdded} categorie, +${rep.keywordsAdded} keyword`);
		return {
			section: 'cat',
			target: '',
			message:
				`Import ${mode === 'replace' ? 'con sostituzione' : 'in aggiunta'}: ${rep.categoriesAdded} categorie nuove, ` +
				`${rep.categoriesUpdated} già presenti, ${rep.keywordsAdded} keyword aggiunte` +
				(rep.skipped.length ? `, ${rep.skipped.length} keyword scartate perché già in un'altra categoria.` : '.'),
			skipped: rep.skipped
		};
	},

	loadStarter: async () => {
		const rep = importCategories(STARTER_CATEGORIES, 'merge');
		return {
			section: 'cat',
			target: '',
			message: `Set suggerito: ${rep.categoriesAdded} categorie nuove, ${rep.keywordsAdded} keyword aggiunte. Le categorie esistenti non sono state toccate.`,
			skipped: rep.skipped
		};
	},

	testDescription: async ({ request }) => {
		const f = await request.formData();
		const description = String(f.get('description') || '');
		const m = matchCategory(description, loadRules().rules);
		return {
			section: 'cat-test',
			test: { description, category: m?.category ?? UNKNOWN, keyword: m?.keyword ?? null }
		};
	},

	keywordReport: async () => {
		const stmt = db.prepare(
			'SELECT COUNT(*) AS c, MAX(date) AS last FROM expenses WHERE instr(lower(description), lower(?)) > 0'
		);
		const report = loadRules().rules.map((r) => {
			const row = stmt.get(r.keyword) as { c: number; last: string | null };
			return { keyword: r.keyword, category: r.category, matches: row.c, last: row.last };
		});
		report.sort((a, b) => a.matches - b.matches || a.category.localeCompare(b.category));
		return { section: 'cat-report', report };
	}
};
