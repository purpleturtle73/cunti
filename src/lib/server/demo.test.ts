import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-demo';
fs.rmSync('tmp/test-demo', { recursive: true, force: true });
fs.mkdirSync('tmp/test-demo', { recursive: true });

const { db } = await import('./db');
const { ensureCategoriesMigrated, importCategories, listCategoryDefs, loadMeta, transferCategories } = await import('./categorize');
const { STARTER_CATEGORIES } = await import('./starter-categories');
const { createDemoFinances, createDemoInvestments, DEMO_BUDGETS, DEMO_CARD_NAMES, isDemoSymbol } = await import('./demo');
const { findConflicts, listBudgets, recurring } = await import('./expenses');
const { buildSnapshot } = await import('./portfolio');

const TODAY = new Date('2026-10-04T12:00:00Z');
const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;

describe('dati demo — Finanze', () => {
	it('crea due anni di movimenti categorizzati con il set di default', async () => {
		// configurazione "personale" preesistente: categoria propria che cattura esselunga, card propria
		ensureCategoriesMigrated();
		importCategories({ supermercato_mio: { keywords: ['esselunga'] }, stipendio_mario: { keywords: ['stipendio'] } }, 'replace');
		db.prepare("INSERT INTO cards (name) VALUES ('MASTERCARD')").run();

		const rep = (await createDemoFinances(TODAY))!;
		expect(rep).not.toBeNull();
		expect(rep.inserted).toBe(count('expenses'));
		expect(rep.inserted).toBeGreaterThan(500);
		expect(fs.existsSync(`tmp/test-demo/backups/${rep.backup}`)).toBe(true);

		// solo le categorie di default: quelle personali e le loro keyword sono sparite
		const names = listCategoryDefs().map((c) => c.name);
		expect(names.sort()).toEqual(Object.keys(STARTER_CATEGORIES).sort());
		expect(rep.categories).toBe(Object.keys(STARTER_CATEGORIES).length);
		expect(Object.fromEntries(listBudgets())).toEqual(DEMO_BUDGETS);
		const used = (db.prepare("SELECT DISTINCT category FROM expenses WHERE category != 'unknown'").all() as { category: string }[]).map((r) => r.category);
		for (const c of used) expect(names).toContain(c);
		expect(db.prepare("SELECT DISTINCT category FROM expenses WHERE description LIKE '%ESSELUNGA%'").all()).toEqual([{ category: 'spesa' }]);

		const range = db.prepare('SELECT MIN(date) AS a, MAX(date) AS b FROM expenses').get() as { a: string; b: string };
		expect(range.b <= '2026-10-04').toBe(true);
		expect(range.a >= '2024-11-01').toBe(true);

		const byCat = new Map(
			(db.prepare('SELECT category, COUNT(*) AS n FROM expenses GROUP BY category').all() as { category: string; n: number }[]).map(
				(r) => [r.category, r.n]
			)
		);
		// 24 mesi, ma al 4 ottobre stipendio (27) e giroconto (28) del mese non ci sono ancora;
		// il giroconto ha due gambe (uscita dal conto, entrata sul trading)
		expect(byCat.get('stipendio')).toBe(23);
		expect(byCat.get('trasferimenti')).toBe(46);
		expect(rep.unknown).toBe(byCat.get('unknown'));
		expect(rep.unknown).toBeGreaterThan(0);
	});

	it('usa solo i conti e le carte demo, configurati con logo', () => {
		const used = (db.prepare('SELECT DISTINCT card FROM expenses ORDER BY card').all() as { card: string }[]).map((r) => r.card);
		expect(used).toEqual([...DEMO_CARD_NAMES].sort());
		const configured = db.prepare('SELECT name, logo IS NOT NULL AS has_logo FROM cards ORDER BY name').all() as { name: string; has_logo: number }[];
		expect(configured.map((c) => c.name)).toEqual([...DEMO_CARD_NAMES].sort());
		expect(configured.every((c) => c.has_logo === 1)).toBe(true);
	});

	it('popola i conflitti, da rivedere e bloccati', () => {
		expect(findConflicts(false).some((g) => g.category === 'viaggi' && g.ruleCategory === 'ristoranti')).toBe(true);
		expect(findConflicts(true).some((g) => g.category === 'casa' && g.ruleCategory === 'shopping')).toBe(true);
	});

	it('le ricorrenti riconoscono abbonamenti e costi fissi, non il giroconto', () => {
		const labels = recurring(transferCategories(loadMeta())).map((r) => r.label);
		for (const l of ['ADDEBITO AFFITTO APPARTAMENTO', 'NETFLIX.COM AMSTERDAM', 'SPOTIFY STOCKHOLM', 'PALESTRA FIT CENTER QUOTA MENSILE'])
			expect(labels).toContain(l);
		expect(labels.filter((l) => l.startsWith('GIROCONTO'))).toEqual([]);
		// voli e hotel delle vacanze tornano due volte l'anno, a importi diversi: non ricorrenti
		expect(labels.filter((l) => /RYANAIR|EASYJET|ITA AIRWAYS|BOOKING/.test(l))).toEqual([]);
	});

	it('non fa nulla se ci sono già movimenti (nemmeno backup o sostituzioni)', async () => {
		const before = count('expenses');
		const backups = fs.readdirSync('tmp/test-demo/backups').length;
		expect(await createDemoFinances(TODAY)).toBeNull();
		expect(count('expenses')).toBe(before);
		expect(fs.readdirSync('tmp/test-demo/backups').length).toBe(backups);
	});

	it('è deterministico a parità di data', async () => {
		const sum = () => (db.prepare('SELECT ROUND(SUM(amount), 2) AS s FROM expenses').get() as { s: number }).s;
		const first = sum();
		db.prepare('DELETE FROM expenses').run();
		await createDemoFinances(TODAY);
		expect(sum()).toBe(first);
	});
});

describe('dati demo — Investimenti', () => {
	it('crea strumenti, prezzi, broker e operazioni coerenti', () => {
		const rep = createDemoInvestments(TODAY)!;
		expect(rep).toMatchObject({ instruments: 3, operations: 41 });
		expect(count('transactions')).toBe(41);
		const snap = buildSnapshot();
		expect(snap.positions.filter((p) => p.quantity > 0)).toHaveLength(3);
		expect(snap.totalValue).toBeGreaterThan(0);
		expect(snap.realizedTotal).not.toBe(0); // la vendita crypto
	});

	it('non fa nulla se ci sono già operazioni', () => {
		expect(createDemoInvestments(TODAY)).toBeNull();
		expect(count('transactions')).toBe(41);
	});

	it('dopo uno svuotamento riusa strumenti e broker demo', () => {
		db.prepare('DELETE FROM transactions').run();
		expect(createDemoInvestments(TODAY)).toMatchObject({ operations: 41 });
		expect(count('instruments')).toBe(3);
		expect(count('brokers')).toBe(2);
	});

	it('i simboli demo sono riconoscibili (il refresh prezzi li salta)', () => {
		expect(isDemoSymbol('DEMOW.MI')).toBe(true);
		expect(isDemoSymbol('democoin')).toBe(true);
		expect(isDemoSymbol('SWDA.MI')).toBe(false);
		expect(isDemoSymbol('bitcoin')).toBe(false);
	});
});
