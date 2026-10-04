import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-categorize';
fs.rmSync('tmp/test-categorize', { recursive: true, force: true });

const { db, getSetting, setSetting } = await import('./db');
const cat = await import('./categorize');
const { budgetStatus, createRuleFromMovement, findConflicts, listBudgets, resolveConflicts, runRulesOnUnknown, setBudgets } = await import('./expenses');
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

describe('crea regola da una voce', () => {
	beforeEach(() => reset({ spesa: ['esselunga'], ristoranti: ['pizzeria'], shopping: [] }));

	it('aggiunge la keyword e categorizza le voci senza categoria', () => {
		ins.run('2026-02-01', 'PAGAMENTO POS DECATHLON 12', 'conto', -40, 'unknown', 0);
		ins.run('2026-02-03', 'POS DECATHLON MONZA', 'conto', -15, 'unknown', 0);
		const id = (db.prepare("SELECT id FROM expenses WHERE description LIKE 'PAGAMENTO%'").get() as { id: number }).id;
		const res = createRuleFromMovement(id, ' Decathlon ', 'shopping', true);
		expect(res).toEqual({ ok: true, keyword: 'decathlon', applied: 2, newConflicts: 0 });
		expect(cat.listCategoryDefs().find((c) => c.name === 'shopping')!.keywords.map((k) => k.keyword)).toEqual(['decathlon']);
		expect(catOf('POS DECATHLON MONZA').category).toBe('shopping');
	});

	it('senza "applica" aggiunge solo la keyword', () => {
		ins.run('2026-02-01', 'POS DECATHLON', 'conto', -40, 'unknown', 0);
		const id = (db.prepare('SELECT id FROM expenses').get() as { id: number }).id;
		expect(createRuleFromMovement(id, 'decathlon', 'shopping', false)).toMatchObject({ ok: true, applied: 0 });
		expect(catOf('POS DECATHLON').category).toBe('unknown');
	});

	it('segnala i conflitti nati: voci già categorizzate altrove che la keyword sposterebbe', () => {
		ins.run('2026-02-01', 'POS DECATHLON', 'conto', -40, 'unknown', 0);
		ins.run('2026-02-02', 'DECATHLON RIMBORSO', 'conto', 10, 'spesa', 0); // ora le regole direbbero shopping
		const id = (db.prepare("SELECT id FROM expenses WHERE category = 'unknown'").get() as { id: number }).id;
		expect(createRuleFromMovement(id, 'decathlon', 'shopping', true)).toMatchObject({ ok: true, applied: 1, newConflicts: 1 });
	});

	it('rifiuta keyword corte, assenti dalla descrizione o già usate', () => {
		ins.run('2026-02-01', 'POS ESSELUNGA DECATHLON', 'conto', -40, 'unknown', 0);
		const id = (db.prepare('SELECT id FROM expenses').get() as { id: number }).id;
		expect(createRuleFromMovement(id, 'de', 'shopping', true)).toMatchObject({ ok: false });
		expect(createRuleFromMovement(id, 'ikea', 'shopping', true)).toMatchObject({ ok: false });
		expect(createRuleFromMovement(id, 'esselunga', 'shopping', true)).toMatchObject({
			ok: false,
			error: 'La keyword "esselunga" è già nella categoria "spesa".'
		});
		expect(createRuleFromMovement(999999, 'decathlon', 'shopping', true)).toMatchObject({ ok: false });
		expect(catOf('POS ESSELUNGA DECATHLON').category).toBe('unknown');
	});
});

describe('budget per categoria', () => {
	beforeEach(() => {
		reset({ spesa: ['esselunga'], ristoranti: ['pizzeria'], svago: [] });
		db.prepare('DELETE FROM budgets').run();
	});
	const TODAY = new Date('2026-10-10T12:00:00Z'); // 10 ottobre: 10/31 del mese trascorso

	it('mese: spesa del mese contro il budget, con ritmo atteso e stati', () => {
		setBudgets(new Map([['spesa', 300], ['ristoranti', 100], ['svago', 50]]));
		ins.run('2026-10-02', 'Esselunga', 'conto', -150, 'spesa', 0); // 50%, ma ritmo atteso ~97 → attenzione
		ins.run('2026-10-03', 'Pizzeria', 'conto', -120, 'ristoranti', 0); // sforato
		ins.run('2026-10-04', 'Cinema', 'conto', -10, 'svago', 0); // ok
		ins.run('2026-09-20', 'Esselunga', 'conto', -999, 'spesa', 0); // altro mese: escluso
		ins.run('2026-10-05', 'Rimborso', 'conto', 40, 'spesa', 0); // entrata: non è spesa
		const s = budgetStatus('2026', '10', TODAY);
		expect(s).toMatchObject({ kind: 'month', key: '2026-10', months: 1, totalBudget: 450, totalSpent: 280, over: 1 });
		expect(s.pace).toBeCloseTo(10 / 31);
		const by = new Map(s.rows.map((r) => [r.category, r]));
		expect(by.get('ristoranti')).toMatchObject({ spent: 120, state: 'over' });
		expect(by.get('spesa')).toMatchObject({ spent: 150, state: 'warn' });
		expect(by.get('spesa')!.expected).toBeCloseTo(300 * (10 / 31));
		expect(by.get('svago')).toMatchObject({ spent: 10, state: 'ok' });
		expect(s.rows[0].category).toBe('ristoranti'); // ordinate per % usata
	});

	it('anno: budget × 12; un periodo passato non ha ritmo; nessun filtro = mese corrente', () => {
		setBudgets(new Map([['spesa', 100]]));
		ins.run('2025-03-02', 'Esselunga', 'conto', -1000, 'spesa', 0);
		const y = budgetStatus('2025', '', TODAY);
		expect(y).toMatchObject({ kind: 'year', key: '2025', months: 12, pace: null });
		expect(y.rows[0]).toMatchObject({ budget: 1200, spent: 1000, expected: null, state: 'ok' });
		expect(budgetStatus('', '', TODAY).key).toBe('2026-10');
		expect(budgetStatus('2026', '', TODAY).pace).toBeCloseTo((9 + 10 / 31) / 12);
	});

	it('vuoto o zero toglie il budget; segue la categoria rinominata o unita', () => {
		setBudgets(new Map([['spesa', 300], ['ristoranti', 100]]));
		setBudgets(new Map([['ristoranti', null]]));
		expect([...listBudgets()]).toEqual([['spesa', 300]]);
		cat.renameCategory('spesa', 'alimentari');
		expect([...listBudgets()]).toEqual([['alimentari', 300]]);
		// unione verso una categoria senza budget: il budget passa alla destinazione
		cat.renameCategory('alimentari', 'svago');
		expect([...listBudgets()]).toEqual([['svago', 300]]);
		// eliminare la categoria elimina il budget
		cat.deleteCategory('svago');
		expect(listBudgets().size).toBe(0);
	});
});

describe('budget: ritmo a inizio periodo', () => {
	it('nei primi giorni del mese il ritmo non fa scattare l\'avviso', () => {
		reset({ spesa: [] });
		db.prepare('DELETE FROM budgets').run();
		setBudgets(new Map([['spesa', 300]]));
		ins.run('2026-10-02', 'Esselunga', 'conto', -60, 'spesa', 0); // 20%, sopra il ritmo del 3 ottobre
		const early = budgetStatus('2026', '10', new Date('2026-10-03T12:00:00Z'));
		expect(early.rows[0].state).toBe('ok');
		const later = budgetStatus('2026', '10', new Date('2026-10-07T12:00:00Z')); // 7/31 > 20%
		expect(later.rows[0].state).toBe('ok'); // 60 < 300 × 7/31 × 1,1
		ins.run('2026-10-06', 'Esselunga', 'conto', -40, 'spesa', 0);
		expect(budgetStatus('2026', '10', new Date('2026-10-07T12:00:00Z')).rows[0].state).toBe('warn');
	});
});
