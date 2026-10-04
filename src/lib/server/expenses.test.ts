import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-expenses';
fs.rmSync('tmp/test-expenses', { recursive: true, force: true });
fs.mkdirSync('tmp/test-expenses', { recursive: true });

const { db } = await import('./db');
const { addKeyword, createCategory, deleteCategory, loadRules, matchCategory } = await import('./categorize');
const {
	applyStaging,
	cardTotals,
	cardUsage,
	categorizeRows,
	categoryTrend,
	conflictKey,
	coverage,
	exportExpensesCsv,
	monthsInPeriod,
	recurring,
	renameCard,
	stageImport,
	wipeExpenses
} = await import('./expenses');
const { parseExpensesCsv } = await import('./expensecsv');

const RULES = {
	supermercato: ['esselunga', 'carrefour'],
	ristoranti_bar: ['bar', 'ristorante'],
	stipendio: ['Stipendi E Pensioni'],
	investimenti: ['GIROCONTO']
};

function writeRules(obj: unknown) {
	fs.writeFileSync(path.join('tmp/test-expenses', 'categories.json'), JSON.stringify(obj));
}

function count(): number {
	return (db.prepare('SELECT COUNT(*) AS c FROM expenses').get() as { c: number }).c;
}

beforeAll(() => {
	writeRules(RULES);
});

describe('categorize', () => {
	it('substring case-insensitive, keyword più lunga vince', () => {
		const { rules } = loadRules();
		// "ristorante" (10) batte "bar" (3) anche se "bar" compare prima
		expect(matchCategory('RISTORANTE DA BARtolo', rules)?.category).toBe('ristoranti_bar');
		expect(matchCategory('RISTORANTE DA BARtolo', rules)?.keyword).toBe('ristorante');
		expect(matchCategory('ESSELUNGA SPA', rules)?.category).toBe('supermercato');
		expect(matchCategory('nulla di noto', rules)).toBeNull();
	});

	it('le regole vengono migrate una volta dal vecchio categories.json', () => {
		// beforeAll ha scritto il file: il primo loadRules lo ha importato nel DB
		const r = loadRules();
		expect(r.categories).toEqual(expect.arrayContaining(Object.keys(RULES)));
		expect(r.rules).toHaveLength(Object.values(RULES).flat().length);
		// modificare il file dopo la migrazione non ha più effetto: la fonte è il DB
		writeRules({ altro: ['zzz'] });
		expect(loadRules().categories).not.toContain('altro');
		writeRules(RULES);
	});

	it('segnala keyword con sintassi regex come sospette', () => {
		addKeyword('trasporti_test', 'x'); // categoria inesistente: rifiutata
		createCategory('trasporti_test');
		addKeyword('trasporti_test', 'PV[0-9][0-9]');
		const r = loadRules();
		expect(r.warnings.some((w) => w.includes('PV[0-9][0-9]'))).toBe(true);
		deleteCategory('trasporti_test');
	});

	it('categorizeRows: categoria CSV vince, regole su null, fallback unknown, card di default', () => {
		const { rows } = parseExpensesCsv(
			[
				'data_ops;descrizione;card;importo;categoria',
				'01/02/2025;Esselunga Milano;;-10;già_categorizzata',
				'01/02/2025;Esselunga Milano;;-10;',
				'01/02/2025;Boh;;-10;'
			].join('\n')
		);
		const { staged } = categorizeRows(rows, 'BancaX');
		expect(staged.map((s) => [s.category, s.source, s.card])).toEqual([
			['già_categorizzata', 'csv', 'BancaX'],
			['supermercato', 'rules', 'BancaX'],
			['unknown', 'unknown', 'BancaX']
		]);
	});
});

describe('import a due fasi con dedup a conteggio', () => {
	const csv = (rows: string[]) => parseExpensesCsv(['data_ops;descrizione;importo;categoria', ...rows].join('\n')).rows;

	it('prima importazione: tutto nuovo; conferma inserisce', () => {
		const preview = stageImport(csv(['01/03/2025;Bar Uno;-3;', '01/03/2025;Bar Uno;-3;', '02/03/2025;Esselunga;-20;']), 'conto');
		expect(preview.toInsert).toBe(3); // due caffè identici legittimi
		expect(preview.skippedDuplicates).toBe(0);
		expect(preview.bySource.rules).toBe(3);
		const res = applyStaging(preview.token, new Set());
		expect(res).toEqual({ inserted: 3, updatedCategories: 0 });
		expect(count()).toBe(3);
	});

	it('reimport dello stesso file: idempotente (tutto saltato)', () => {
		const preview = stageImport(csv(['01/03/2025;Bar Uno;-3;', '01/03/2025;Bar Uno;-3;', '02/03/2025;Esselunga;-20;']), 'conto');
		expect(preview.toInsert).toBe(0);
		expect(preview.skippedDuplicates).toBe(3);
		applyStaging(preview.token, new Set());
		expect(count()).toBe(3);
	});

	it('dedup a conteggio: terza occorrenza identica entra', () => {
		const preview = stageImport(csv(['01/03/2025;Bar Uno;-3;', '01/03/2025;Bar Uno;-3;', '01/03/2025;Bar Uno;-3;']), 'conto');
		expect(preview.toInsert).toBe(1);
		expect(preview.skippedDuplicates).toBe(2);
		applyStaging(preview.token, new Set());
		expect(count()).toBe(4);
	});

	it('conflitto di categoria: stessa chiave, categoria diversa → scelta csv aggiorna il DB', () => {
		const preview = stageImport(csv(['02/03/2025;Esselunga;-20;spesa_grossa']), 'conto');
		expect(preview.toInsert).toBe(0);
		expect(preview.conflicts).toHaveLength(1);
		expect(preview.conflicts[0]).toMatchObject({ dbCategory: 'supermercato', csvCategory: 'spesa_grossa' });

		// scelta "usa CSV"
		const res = applyStaging(preview.token, new Set([conflictKey(preview.conflicts[0])]));
		expect(res?.updatedCategories).toBe(1);
		const cat = (db.prepare("SELECT category FROM expenses WHERE description = 'Esselunga'").get() as { category: string }).category;
		expect(cat).toBe('spesa_grossa');
	});

	it('conflitto risolto "tieni DB": nessun aggiornamento', () => {
		const preview = stageImport(csv(['02/03/2025;Esselunga;-20;altra_ancora']), 'conto');
		expect(preview.conflicts).toHaveLength(1);
		const res = applyStaging(preview.token, new Set());
		expect(res?.updatedCategories).toBe(0);
	});

	it('token inesistente → null', () => {
		expect(applyStaging('00000000-0000-0000-0000-000000000000', new Set())).toBeNull();
	});
});

describe('export e wipe', () => {
	it('export CSV round-trip: reimport di quanto esportato = tutto duplicato', () => {
		const out = exportExpensesCsv();
		expect(out).toContain('data_ops;descrizione;card;importo;moneyin;moneyout;categoria');
		expect(out).toContain('01/03/2025;Bar Uno;conto;-3.00;0.00;3.00;ristoranti_bar');
		const { rows, errors } = parseExpensesCsv(out);
		expect(errors).toEqual([]);
		const preview = stageImport(rows, 'conto');
		expect(preview.toInsert).toBe(0);
		expect(preview.skippedDuplicates).toBe(count());
		applyStaging(preview.token, new Set());
	});

	it('wipe: backup prima, poi tabella vuota', async () => {
		const before = count();
		expect(before).toBeGreaterThan(0);
		const removed = await wipeExpenses();
		expect(removed).toBe(before);
		expect(count()).toBe(0);
		// backup creato
		const backups = fs.readdirSync(path.join('tmp/test-expenses', 'backups')).filter((f) => f.endsWith('.db'));
		expect(backups.length).toBeGreaterThan(0);
	});

	it('wipe + reimport del file esportato = ripristino completo', () => {
		// ricostruzione: DB vuoto → reimport export precedente
		const preview = stageImport(csvRows(), 'conto');
		expect(preview.skippedDuplicates).toBe(0);
		applyStaging(preview.token, new Set());
		expect(count()).toBe(preview.toInsert);
	});

	function csvRows() {
		return parseExpensesCsv(
			['data_ops;descrizione;importo;categoria', '01/03/2025;Bar Uno;-3;ristoranti_bar', '02/03/2025;Esselunga;-20;supermercato'].join('\n')
		).rows;
	}
});

describe('query per card: uso, normalizzazione, totali', () => {
	function seedCards() {
		db.prepare('DELETE FROM expenses').run();
		const ins = db.prepare('INSERT INTO expenses (date, description, card, amount, category) VALUES (?, ?, ?, ?, ?)');
		ins.run('2026-01-05', 'Spesa A', 'MASTERCARD - 1234', -10, 'supermercato');
		ins.run('2026-01-06', 'Spesa B', 'MASTERCARD - 1234', -20, 'supermercato');
		ins.run('2026-02-07', 'Spesa C', 'bancomatAlfa', -5, 'ristoranti_bar');
		ins.run('2026-02-08', 'Spesa D', 'BancomatAlfa', -7, 'ristoranti_bar');
		ins.run('2026-02-09', 'Stipendio', 'conto', 1500, 'stipendio');
		ins.run('2026-02-10', 'Giro', 'conto', -100, 'investimenti'); // transfer
	}

	it('cardUsage elenca i valori distinti con conteggi e intervallo di date', () => {
		seedCards();
		const usage = cardUsage();
		expect(usage.map((u) => u.card).sort()).toEqual([
			'BancomatAlfa',
			'MASTERCARD - 1234',
			'bancomatAlfa',
			'conto'
		]);
		const mc = usage.find((u) => u.card === 'MASTERCARD - 1234')!;
		expect(mc.count).toBe(2);
		expect(mc.first).toBe('2026-01-05');
		expect(mc.last).toBe('2026-01-06');
		// ordinato per conteggio decrescente
		expect(usage[0].count).toBeGreaterThanOrEqual(usage[1].count);
	});

	it('renameCard verso un valore esistente unisce le due varianti', () => {
		seedCards();
		expect(renameCard('bancomatAlfa', 'BancomatAlfa')).toBe(1);
		const usage = cardUsage();
		expect(usage.map((u) => u.card)).not.toContain('bancomatAlfa');
		expect(usage.find((u) => u.card === 'BancomatAlfa')!.count).toBe(2);
	});

	it('renameCard su un valore inesistente non cambia nulla', () => {
		seedCards();
		expect(renameCard('NonEsiste', 'conto')).toBe(0);
	});

	it('cardTotals somma per card ed esclude i transfer', () => {
		seedCards();
		const tot = cardTotals('2026', new Set(['investimenti']));
		const byCard = new Map(tot.map((t) => [t.card, t]));
		expect(byCard.get('MASTERCARD - 1234')!.moneyOut).toBeCloseTo(30);
		expect(byCard.get('conto')!.moneyIn).toBeCloseTo(1500);
		// il giroconto da -100 su "conto" è escluso
		expect(byCard.get('conto')!.moneyOut).toBeCloseTo(0);
	});

	it('cardTotals rispetta il periodo', () => {
		seedCards();
		const gen = cardTotals('2026-01', new Set());
		expect(gen).toHaveLength(1);
		expect(gen[0].card).toBe('MASTERCARD - 1234');
	});
});

describe('copertura, medie e andamento categoria', () => {
	function seedCoverage() {
		db.prepare('DELETE FROM expenses').run();
		const ins = db.prepare('INSERT INTO expenses (date, description, card, amount, category) VALUES (?, ?, ?, ?, ?)');
		ins.run('2025-01-10', 'A', 'conto', -10, 'supermercato');
		ins.run('2025-06-10', 'B', 'conto', -30, 'supermercato');
		ins.run('2026-01-10', 'C', 'conto', -20, 'supermercato');
		ins.run('2026-01-11', 'D', 'conto', -5, 'unknown');
		ins.run('2026-03-11', 'E', 'conto', -5, 'unknown');
	}

	it('coverage conta le voci unknown nel periodo', () => {
		seedCoverage();
		expect(coverage('')).toEqual({ total: 5, unknown: 2 });
		expect(coverage('2026')).toEqual({ total: 3, unknown: 2 });
		expect(coverage('2025')).toEqual({ total: 2, unknown: 0 });
	});

	it('monthsInPeriod conta i mesi distinti con dati', () => {
		seedCoverage();
		expect(monthsInPeriod('')).toBe(4); // 2025-01, 2025-06, 2026-01, 2026-03
		expect(monthsInPeriod('2026')).toBe(2);
		expect(monthsInPeriod('2026-01')).toBe(1);
	});

	it('categoryTrend dà una serie per anno senza anno, per mese con anno', () => {
		seedCoverage();
		const yearly = categoryTrend('supermercato', '');
		expect(yearly.map((t) => t.label)).toEqual(['2025', '2026']);
		expect(yearly[0].moneyOut).toBeCloseTo(40); // 10 + 30 nel 2025
		expect(yearly[1].moneyOut).toBeCloseTo(20);

		const monthly = categoryTrend('supermercato', '2025');
		expect(monthly.map((t) => t.label)).toEqual(['2025-01', '2025-06']);
		expect(monthly[1].moneyOut).toBeCloseTo(30);
	});

	it('categoryTrend di una categoria senza movimenti è vuoto', () => {
		seedCoverage();
		expect(categoryTrend('inesistente', '')).toEqual([]);
	});
});

describe('recurring — riconoscimento euristico delle uscite ricorrenti', () => {
	const ins = () =>
		db.prepare('INSERT INTO expenses (date, description, card, amount, category) VALUES (?, ?, ?, ?, ?)');

	it('riconosce un abbonamento a importo stabile su più mesi', () => {
		db.prepare('DELETE FROM expenses').run();
		const i = ins();
		for (const m of ['01', '02', '03', '04', '05']) i.run(`2026-${m}-10`, 'Addebito Abbonamento Streaming', 'conto', -12.99, 'svago');
		const rec = recurring(new Set());
		expect(rec).toHaveLength(1);
		expect(rec[0].months).toBe(5);
		expect(rec[0].amount).toBeCloseTo(12.99);
		expect(rec[0].yearly).toBeCloseTo(12.99 * 12);
	});

	it('scarta chi compare in pochi mesi', () => {
		db.prepare('DELETE FROM expenses').run();
		const i = ins();
		for (const m of ['01', '02']) i.run(`2026-${m}-10`, 'Addebito Abbonamento Streaming', 'conto', -12.99, 'svago');
		expect(recurring(new Set())).toEqual([]);
	});

	it('scarta le spese ricorrenti ma di importo variabile', () => {
		db.prepare('DELETE FROM expenses').run();
		const i = ins();
		const amounts = [-12, -80, -45, -150, -30];
		amounts.forEach((a, k) => i.run(`2026-0${k + 1}-10`, 'Pagamento Supermercato Esselunga', 'conto', a, 'supermercato'));
		expect(recurring(new Set())).toEqual([]);
	});

	it('tollera un cambio di prezzo entro il 15% e usa la mediana', () => {
		db.prepare('DELETE FROM expenses').run();
		const i = ins();
		for (const m of ['01', '02', '03']) i.run(`2026-${m}-10`, 'Canone Internet Fibra', 'conto', -30, 'utenze');
		for (const m of ['04', '05']) i.run(`2026-${m}-10`, 'Canone Internet Fibra', 'conto', -32, 'utenze');
		const rec = recurring(new Set());
		expect(rec).toHaveLength(1);
		expect(rec[0].amount).toBeCloseTo(30);
	});

	it('ignora entrate e categorie transfer', () => {
		db.prepare('DELETE FROM expenses').run();
		const i = ins();
		for (const m of ['01', '02', '03', '04']) {
			i.run(`2026-${m}-27`, 'Stipendi E Pensioni Da Azienda', 'conto', 2000, 'stipendio'); // entrata
			i.run(`2026-${m}-28`, 'GIROCONTO Verso Deposito', 'conto', -500, 'investimenti'); // transfer
		}
		expect(recurring(new Set(['investimenti']))).toEqual([]);
	});

	it('raggruppa descrizioni che differiscono solo per numeri', () => {
		db.prepare('DELETE FROM expenses').run();
		const i = ins();
		['01', '02', '03', '04'].forEach((m, k) =>
			i.run(`2026-${m}-10`, `Addebito Sepa Palestra rif ${1000 + k}`, 'conto', -45, 'sport')
		);
		const rec = recurring(new Set());
		expect(rec).toHaveLength(1);
		expect(rec[0].months).toBe(4);
	});

	it('marca come non attive le voci non più viste da oltre 90 giorni', () => {
		db.prepare('DELETE FROM expenses').run();
		const i = ins();
		for (const m of ['01', '02', '03', '04']) i.run(`2020-${m}-10`, 'Vecchio Abbonamento Rivista', 'conto', -9.9, 'svago');
		const rec = recurring(new Set());
		expect(rec).toHaveLength(1);
		expect(rec[0].active).toBe(false);
	});
});
