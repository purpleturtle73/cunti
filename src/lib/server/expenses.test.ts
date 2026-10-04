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
	balanceSeries,
	exportExpensesCsv,
	filterConditions,
	filteredInOut,
	monthsInPeriod,
	NO_FILTERS,
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

describe('filtri della pagina Spese e ricorrenti filtrate', () => {
	function seedFiltered() {
		db.prepare('DELETE FROM expenses').run();
		db.prepare('DELETE FROM cards').run();
		const i = db.prepare('INSERT INTO expenses (date, description, card, amount, category) VALUES (?, ?, ?, ?, ?)');
		// abbonamento a cavallo d'anno: 3 mesi nel 2025, 2 nel 2026
		for (const d of ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
			i.run(`${d}-05`, 'Addebito Streaming Video', 'MASTERCARD - 1234', -9.99, 'svago');
		// rata finita nel 2025
		for (const m of ['01', '02', '03', '04']) i.run(`2025-${m}-15`, 'Rata Finanziamento Divano', 'conto', -80, 'casa');
		// versamento mensile su un giroconto
		for (const m of ['01', '02', '03', '04']) i.run(`2026-${m}-27`, 'GIROCONTO Verso Deposito', 'conto', -500, 'investimenti');
		// spesa non ricorrente nel 2026
		i.run('2026-01-20', 'Ferramenta', 'conto', -40, 'casa');
	}
	const T = new Set(['investimenti']);
	const f = (patch: Partial<typeof NO_FILTERS>) => ({ ...NO_FILTERS, ...patch });

	it('senza periodo mostra tutte le ricorrenti, con il totale sullo storico', () => {
		seedFiltered();
		const rec = recurring(T);
		expect(rec.map((r) => r.label).sort()).toEqual(['Addebito Streaming Video', 'Rata Finanziamento Divano']);
		const s = rec.find((r) => r.label === 'Addebito Streaming Video')!;
		expect(s.periodCount).toBe(5);
		expect(s.periodTotal).toBeCloseTo(9.99 * 5);
	});

	it("l'anno sceglie le ricorrenti addebitate nel periodo, riconosciute su tutto lo storico", () => {
		seedFiltered();
		const rec = recurring(T, f({ year: '2026' }));
		// la rata è finita nel 2025; lo streaming nel 2026 ha solo 2 mesi ma è ricorrente sullo storico
		expect(rec.map((r) => r.label)).toEqual(['Addebito Streaming Video']);
		expect(rec[0].months).toBe(5);
		expect(rec[0].periodCount).toBe(2);
		expect(rec[0].periodTotal).toBeCloseTo(19.98);
	});

	it('il mese restringe ulteriormente il periodo', () => {
		seedFiltered();
		expect(recurring(T, f({ year: '2025', month: '03' })).map((r) => r.label)).toEqual(['Rata Finanziamento Divano']);
		expect(recurring(T, f({ year: '2026', month: '03' }))).toEqual([]);
	});

	it('categoria e categorie escluse restringono le uscite analizzate', () => {
		seedFiltered();
		expect(recurring(T, f({ category: 'casa' })).map((r) => r.label)).toEqual(['Rata Finanziamento Divano']);
		expect(recurring(T, f({ exCategories: ['svago'] })).map((r) => r.label)).toEqual(['Rata Finanziamento Divano']);
	});

	it('una categoria giroconto scelta esplicitamente viene analizzata', () => {
		seedFiltered();
		expect(recurring(T).map((r) => r.label)).not.toContain('GIROCONTO Verso Deposito');
		const rec = recurring(T, f({ category: 'investimenti' }));
		expect(rec.map((r) => r.label)).toEqual(['GIROCONTO Verso Deposito']);
	});

	it('escludere una card configurata esclude i valori grezzi che raggruppa', () => {
		seedFiltered();
		db.prepare("INSERT INTO cards (name) VALUES ('Mastercard')").run();
		const { where, params } = filterConditions(f({ exCards: ['Mastercard'] }));
		const n = (
			db.prepare(`SELECT COUNT(*) AS c FROM expenses WHERE ${where.join(' AND ')}`).get(...params) as { c: number }
		).c;
		expect(n).toBe(9); // 14 voci meno le 5 su "MASTERCARD - 1234"
		expect(recurring(T, f({ exCards: ['Mastercard'] })).map((r) => r.label)).toEqual(['Rata Finanziamento Divano']);
		// anche il valore grezzo funziona
		expect(recurring(T, f({ exCards: ['MASTERCARD - 1234'] })).map((r) => r.label)).toEqual(['Rata Finanziamento Divano']);
	});

	it('la ricerca filtra per descrizione', () => {
		seedFiltered();
		expect(recurring(T, f({ q: 'streaming' })).map((r) => r.label)).toEqual(['Addebito Streaming Video']);
	});

	it('balanceSeries: saldo cumulato su giorni consecutivi, giroconti esclusi, filtri applicati', () => {
		db.prepare('DELETE FROM expenses').run();
		const i = db.prepare('INSERT INTO expenses (date, description, card, amount, category) VALUES (?, ?, ?, ?, ?)');
		i.run('2026-02-27', 'Stipendio', 'conto', 1000, 'stipendio');
		i.run('2026-03-01', 'Spesa', 'conto', -100, 'spesa');
		i.run('2026-03-01', 'Bar', 'conto', -5.5, 'ristoranti');
		i.run('2026-03-02', 'Giro', 'conto', -500, 'investimenti');
		i.run('2026-03-04', 'Spesa', 'conto', -50, 'spesa');

		const s = balanceSeries(T, NO_FILTERS);
		// 27/2 → 4/3: giorni consecutivi (2026 non è bisestile), anche quelli senza movimenti
		expect(s.map((p) => p.date)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']);
		expect(s.map((p) => p.value)).toEqual([1000, 1000, 894.5, 894.5, 894.5, 844.5]);

		// categoria scelta: solo quella, giroconto compreso se è lei
		expect(balanceSeries(T, f({ category: 'spesa' })).at(-1)!.value).toBe(-150);
		expect(balanceSeries(T, f({ category: 'investimenti' })).map((p) => p.value)).toEqual([-500]);
		// il periodo dei filtri non taglia la serie (lo sceglie il grafico)
		expect(balanceSeries(T, f({ year: '2026', month: '03' }))[0].date).toBe('2026-02-27');
		expect(balanceSeries(T, f({ q: 'nessuna' }))).toEqual([]);
	});

	it('filteredInOut somma entrate e uscite del periodo esclusi i giroconti, salvo categoria esplicita', () => {
		seedFiltered();
		db.prepare("INSERT INTO expenses (date, description, card, amount, category) VALUES ('2026-02-27', 'Stipendio', 'conto', 1800, 'stipendio')").run();
		db.prepare("INSERT INTO expenses (date, description, card, amount, category) VALUES ('2026-03-01', 'Rientro Deposito', 'conto', 300, 'investimenti')").run();
		expect(filteredInOut(T, f({ year: '2026' }))).toEqual({ moneyIn: 1800, moneyOut: expect.closeTo(19.98 + 40) });
		expect(filteredInOut(T, f({ year: '2026', month: '01' })).moneyOut).toBeCloseTo(9.99 + 40);
		expect(filteredInOut(T, f({ year: '2026', category: 'investimenti' }))).toEqual({ moneyIn: 300, moneyOut: 2000 });
		expect(filteredInOut(T, NO_FILTERS).moneyOut).toBeCloseTo(9.99 * 5 + 320 + 40);
		expect(filteredInOut(T, f({ year: '2026', exCategories: ['stipendio'] })).moneyIn).toBe(0);
		expect(filteredInOut(T, f({ year: '2030' }))).toEqual({ moneyIn: 0, moneyOut: 0 });
	});
});
