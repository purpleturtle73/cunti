import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-expenses';
fs.rmSync('tmp/test-expenses', { recursive: true, force: true });
fs.mkdirSync('tmp/test-expenses', { recursive: true });

const { db } = await import('./db');
const { loadRules, matchCategory } = await import('./categorize');
const { applyStaging, categorizeRows, conflictKey, exportExpensesCsv, stageImport, wipeExpenses } =
	await import('./expenses');
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

	it('segnala keyword con sintassi regex come sospette', () => {
		writeRules({ trasporti: ['PV[0-9][0-9]', 'taxi'] });
		const r = loadRules();
		expect(r.warnings).toHaveLength(1);
		expect(r.warnings[0]).toContain('PV[0-9][0-9]');
		writeRules(RULES);
	});

	it('file malformato → error, nessuna regola', () => {
		fs.writeFileSync(path.join('tmp/test-expenses', 'categories.json'), '{non json');
		const r = loadRules();
		expect(r.error).toBeTruthy();
		expect(r.rules).toEqual([]);
		writeRules(RULES);
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
