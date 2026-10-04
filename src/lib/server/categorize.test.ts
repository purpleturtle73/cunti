import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-categorize';
fs.rmSync('tmp/test-categorize', { recursive: true, force: true });

const { db, getSetting, setSetting } = await import('./db');
const cat = await import('./categorize');
const { findConflicts, resolveConflicts, runRulesOnUnknown } = await import('./expenses');
const { STARTER_CATEGORIES } = await import('./starter-categories');

const ins = db.prepare(
	'INSERT INTO expenses (date, description, card, amount, category, category_manual) VALUES (?, ?, ?, ?, ?, ?)'
);
const catOf = (description: string) =>
	(db.prepare('SELECT category, category_manual AS m FROM expenses WHERE description = ?').get(description) as {
		category: string;
		m: number;
	});

/** Stato pulito: niente spese, categorie definite dal JSON dato. */
function reset(json: Parameters<typeof cat.importCategories>[0] = {}) {
	db.prepare('DELETE FROM expenses').run();
	db.prepare('DELETE FROM expense_categories').run();
	setSetting('categories_source', 'db');
	cat.importCategories(json, 'replace');
}

describe('migrazione e installazione vuota', () => {
	it('su installazione vuota carica il set suggerito, una volta sola', () => {
		db.prepare('DELETE FROM expense_categories').run();
		db.prepare("DELETE FROM settings WHERE key = 'categories_source'").run();
		const defs = cat.listCategoryDefs();
		expect(defs.map((d) => d.name)).toEqual(Object.keys(STARTER_CATEGORIES));
		expect(getSetting('categories_source')).toBe('db');
		// cancellarle tutte non le fa ricomparire
		db.prepare('DELETE FROM expense_categories').run();
		expect(cat.listCategoryDefs()).toEqual([]);
	});

	it('con spese già presenti e nessun file non carica nulla in automatico', () => {
		db.prepare('DELETE FROM expense_categories').run();
		db.prepare("DELETE FROM settings WHERE key = 'categories_source'").run();
		ins.run('2026-01-01', 'qualcosa', 'conto', -1, 'vecchia', 0);
		expect(cat.listCategoryDefs()).toEqual([]);
		db.prepare('DELETE FROM expenses').run();
	});

	it('importa i vecchi categories.json e categories-meta.json uniti', () => {
		db.prepare('DELETE FROM expense_categories').run();
		db.prepare("DELETE FROM settings WHERE key = 'categories_source'").run();
		fs.writeFileSync('tmp/test-categorize/categories.json', JSON.stringify({ spesa: ['coop'], giro: ['giroconto'] }));
		fs.writeFileSync('tmp/test-categorize/categories-meta.json', JSON.stringify({ giro: { transfer: true, icon: 'bank' } }));
		const defs = cat.listCategoryDefs();
		expect(defs.find((d) => d.name === 'spesa')?.keywords.map((k) => k.keyword)).toEqual(['coop']);
		expect(defs.find((d) => d.name === 'giro')).toMatchObject({ transfer: true, icon: 'bank' });
		expect(cat.transferCategories()).toEqual(new Set(['giro']));
		fs.rmSync('tmp/test-categorize/categories.json');
		fs.rmSync('tmp/test-categorize/categories-meta.json');
	});
});

describe('categorie e keyword', () => {
	beforeEach(() => reset({ spesa: ['esselunga'], ristoranti: ['ristorante', 'pizzeria'] }));

	it('crea una categoria e rifiuta nomi vuoti, duplicati e "unknown"', () => {
		expect(cat.createCategory('casa', { icon: 'home' })).toEqual({ ok: true });
		expect(cat.createCategory('casa').ok).toBe(false);
		expect(cat.createCategory('  ').ok).toBe(false);
		expect(cat.createCategory('Unknown').ok).toBe(false);
		expect(cat.listCategoryDefs().find((d) => d.name === 'casa')?.icon).toBe('home');
	});

	it('una keyword appartiene a una sola categoria, senza distinzione di maiuscole', () => {
		const res = cat.addKeyword('ristoranti', 'ESSELUNGA');
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.error).toContain('spesa');
		expect(cat.addKeyword('spesa', 'conad')).toEqual({ ok: true });
	});

	it('la keyword più lunga vince; a parità vince la categoria che viene prima', () => {
		cat.addKeyword('spesa', 'bar');
		cat.createCategory('zz_ultima');
		cat.addKeyword('zz_ultima', 'barbiere');
		const { rules } = cat.loadRules();
		expect(cat.matchCategory('BARBIERE DA MARIO', rules)?.category).toBe('zz_ultima');
		expect(cat.matchCategory('BAR CENTRALE', rules)?.category).toBe('spesa');
	});

	it('rinomina: categoria, keyword e spese seguono il nuovo nome', () => {
		ins.run('2026-01-01', 'Pizzeria Uno', 'conto', -20, 'ristoranti', 1);
		const res = cat.renameCategory('ristoranti', 'mangiare_fuori');
		expect(res).toMatchObject({ ok: true, expenses: 1, merged: false, keywordsMoved: 2 });
		expect(catOf('Pizzeria Uno')).toEqual({ category: 'mangiare_fuori', m: 1 }); // blocco preservato
		expect(cat.listCategoryDefs().find((d) => d.name === 'mangiare_fuori')?.keywords).toHaveLength(2);
	});

	it('rinominare verso una categoria esistente le unisce', () => {
		cat.updateCategoryMeta('spesa', { icon: 'cart' });
		ins.run('2026-01-01', 'Pizzeria Due', 'conto', -20, 'ristoranti', 0);
		const res = cat.renameCategory('ristoranti', 'spesa');
		expect(res).toMatchObject({ ok: true, expenses: 1, merged: true, keywordsMoved: 2 });
		const defs = cat.listCategoryDefs();
		expect(defs.map((d) => d.name)).toEqual(['spesa']);
		expect(defs[0].icon).toBe('cart'); // tiene le proprietà della destinazione
		expect(defs[0].keywords.map((k) => k.keyword).sort()).toEqual(['esselunga', 'pizzeria', 'ristorante']);
	});

	it('unisce anche una categoria usata dalle spese ma non definita', () => {
		ins.run('2026-01-01', 'Vecchia voce', 'conto', -5, 'supermercato', 0);
		const res = cat.renameCategory('supermercato', 'spesa');
		expect(res).toMatchObject({ ok: true, expenses: 1 });
		expect(catOf('Vecchia voce').category).toBe('spesa');
	});

	it('eliminare una categoria riporta le sue voci a unknown e toglie il blocco', () => {
		ins.run('2026-01-01', 'Esselunga Milano', 'conto', -30, 'spesa', 1);
		expect(cat.deleteCategory('spesa')).toEqual({ ok: true, expenses: 1 });
		expect(catOf('Esselunga Milano')).toEqual({ category: 'unknown', m: 0 });
		expect(cat.loadRules().rules.some((r) => r.keyword === 'esselunga')).toBe(false); // keyword in cascata
	});
});

describe('import ed export JSON', () => {
	beforeEach(() => reset({ spesa: ['esselunga'] }));

	it('accetta il formato storico e quello esteso', () => {
		expect(cat.parseCategoriesJson('{"a":["x"]}').ok).toBe(true);
		expect(cat.parseCategoriesJson('{"a":{"keywords":["x"],"icon":"cart","transfer":true}}').ok).toBe(true);
		expect(cat.parseCategoriesJson('[1,2]').ok).toBe(false);
		expect(cat.parseCategoriesJson('{"a":[1]}').ok).toBe(false);
		expect(cat.parseCategoriesJson('{non json').ok).toBe(false);
	});

	it('aggiunta: non tocca l’esistente e scarta le keyword già usate altrove', () => {
		const rep = cat.importCategories({ spesa: ['coop'], bar: ['esselunga', 'caffe'] }, 'merge');
		expect(rep).toMatchObject({ categoriesAdded: 1, categoriesUpdated: 1, keywordsAdded: 2 });
		expect(rep.skipped).toEqual([{ keyword: 'esselunga', category: 'bar', reason: 'già in "spesa"' }]);
	});

	it('sostituzione: rimpiazza categorie e keyword, non le spese', () => {
		ins.run('2026-01-01', 'Esselunga', 'conto', -5, 'spesa', 0);
		cat.importCategories({ nuova: ['zzz'] }, 'replace');
		expect(cat.listCategoryDefs().map((d) => d.name)).toEqual(['nuova']);
		expect(catOf('Esselunga').category).toBe('spesa');
	});

	it('export e reimport con sostituzione danno lo stesso stato', () => {
		cat.updateCategoryMeta('spesa', { icon: 'cart', transfer: true });
		const before = cat.exportCategories();
		cat.importCategories(before, 'replace');
		expect(cat.exportCategories()).toEqual(before);
	});
});

describe('regole sulle voci esistenti', () => {
	beforeEach(() => reset({ spesa: ['esselunga'], ristoranti: ['pizzeria'] }));

	it('ricategorizza solo le voci unknown non bloccate', () => {
		ins.run('2026-01-01', 'ESSELUNGA A', 'conto', -1, 'unknown', 0);
		ins.run('2026-01-02', 'ESSELUNGA B', 'conto', -1, 'unknown', 1); // unknown scelto a mano
		ins.run('2026-01-03', 'NESSUNA REGOLA', 'conto', -1, 'unknown', 0);
		const preview = cat.loadRules() && runRulesOnUnknown(false);
		expect(preview).toMatchObject({ unknown: 2, matched: 1, applied: 0 });
		expect(runRulesOnUnknown(true).applied).toBe(1);
		expect(catOf('ESSELUNGA A').category).toBe('spesa');
		expect(catOf('ESSELUNGA B').category).toBe('unknown');
	});

	it('i conflitti escludono unknown e voci coerenti, e si dividono tra da rivedere e bloccati', () => {
		ins.run('2026-01-01', 'PIZZERIA ESSELUNGA?', 'conto', -1, 'spesa', 0); // regole: spesa (più lunga) → coerente
		ins.run('2026-01-02', 'Pizzeria Uno', 'conto', -1, 'spesa', 0); // regole: ristoranti → conflitto
		ins.run('2026-01-03', 'Pizzeria Due', 'conto', -1, 'spesa', 1); // conflitto ma bloccato
		ins.run('2026-01-04', 'Pizzeria Tre', 'conto', -1, 'unknown', 0); // unknown: non è un conflitto
		const open = findConflicts(false);
		expect(open).toHaveLength(1);
		expect(open[0]).toMatchObject({ category: 'spesa', ruleCategory: 'ristoranti', count: 1, keywords: ['pizzeria'] });
		expect(findConflicts(true)[0].items.map((i) => i.description)).toEqual(['Pizzeria Due']);
	});

	it('risoluzione: applica regola, tieni la mia (blocca), sblocca', () => {
		ins.run('2026-01-02', 'Pizzeria Uno', 'conto', -1, 'spesa', 0);
		ins.run('2026-01-03', 'Pizzeria Due', 'conto', -1, 'spesa', 0);
		const id = (d: string) => (db.prepare('SELECT id FROM expenses WHERE description = ?').get(d) as { id: number }).id;

		expect(resolveConflicts('accept', { id: id('Pizzeria Uno') })).toBe(1);
		expect(catOf('Pizzeria Uno')).toEqual({ category: 'ristoranti', m: 0 });

		expect(resolveConflicts('keep', { category: 'spesa', ruleCategory: 'ristoranti', locked: false })).toBe(1);
		expect(catOf('Pizzeria Due')).toEqual({ category: 'spesa', m: 1 });
		expect(findConflicts(false)).toEqual([]);

		expect(resolveConflicts('unlock', { id: id('Pizzeria Due') })).toBe(1);
		expect(findConflicts(false)[0].count).toBe(1);
	});

	it('un’azione di gruppo tocca solo le voci ancora in conflitto', () => {
		ins.run('2026-01-02', 'Pizzeria Uno', 'conto', -1, 'spesa', 0);
		ins.run('2026-01-05', 'Esselunga Vera', 'conto', -1, 'spesa', 0); // coerente
		expect(resolveConflicts('accept', { category: 'spesa', ruleCategory: 'ristoranti', locked: false })).toBe(1);
		expect(catOf('Esselunga Vera').category).toBe('spesa');
	});
});
