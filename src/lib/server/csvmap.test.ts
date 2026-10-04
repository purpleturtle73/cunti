import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-csvmap';
fs.rmSync('tmp/test-csvmap', { recursive: true, force: true });

const m = await import('./csvmap');

const TODAY = '2026-10-04';

// export "con preambolo", importo unico con segno, categoria e conto della banca
const BANK_A = [
	'Elenco movimenti',
	'Intestatario;Mario Esempio',
	'',
	'Data;Operazione;Dettagli;Conto o carta;Categoria;Importo',
	'02/10/2026;Pagamento POS;ESSELUNGA MILANO;Carta 1234;Spesa;-45,30',
	'01/10/2026;Bonifico;STIPENDIO ACME;Conto 5678;;1.850,00',
	'30/09/2026;Pagamento;NETFLIX;Carta 1234;unknown;-12,99',
	'Saldo contabile;;;;;3.210,55'
].join('\n');

// Dare/Avere con uscite positive, causale e descrizione separate
const BANK_B = [
	'Data contabile;Data valuta;Causale;Descrizione;Dare;Avere',
	'2026-09-15;2026-09-16;ADDEBITO SDD;ENEL ENERGIA;80,10;',
	'2026-09-16;2026-09-16;BONIFICO;RIMBORSO;;25,00',
	'2026-09-17;2026-09-17;ADDEBITO;CANONE;-2,50;'
].join('\n');

describe('lettura e proposta di mappatura', () => {
	it("trova l'intestazione dopo le righe introduttive", () => {
		expect(m.detectHeaderRow(BANK_A)).toBe(3);
		const t = m.readCsvTable(BANK_A, 3);
		expect(t.headerLine).toBe(4);
		expect(t.headers).toEqual(['Data', 'Operazione', 'Dettagli', 'Conto o carta', 'Categoria', 'Importo']);
		expect(t.rows[0]).toEqual({ line: 5, fields: ['02/10/2026', 'Pagamento POS', 'ESSELUNGA MILANO', 'Carta 1234', 'Spesa', '-45,30'] });
	});

	it('propone le colonne dai nomi, preferendo la data operazione alla data valuta', () => {
		const a = m.guessMapping(m.readCsvTable(BANK_A, 3).headers, 3);
		expect(a).toMatchObject({ date: 'Data', amountMode: 'signed', amount: 'Importo', card: 'Conto o carta', category: 'Categoria', skipRows: 3 });
		const b = m.guessMapping(m.readCsvTable(BANK_B).headers);
		expect(b).toMatchObject({
			date: 'Data contabile',
			description: 'Descrizione',
			description2: 'Causale',
			amountMode: 'split',
			moneyIn: 'Avere',
			moneyOut: 'Dare'
		});
	});

	it('riconosce il separatore (virgola e campi tra virgolette)', () => {
		const t = m.readCsvTable('Date,Description,Amount\n2026-09-01,"Coffee, bar",-3.50\n');
		expect(t.sep).toBe(',');
		expect(t.rows[0].fields).toEqual(['2026-09-01', 'Coffee, bar', '-3.50']);
	});
});

describe('applicazione della mappatura', () => {
	it('importo con segno, card e categoria dal file, totali in fondo ignorati', () => {
		const t = m.readCsvTable(BANK_A, 3);
		const mapping = { ...m.guessMapping(t.headers, 3), description: 'Dettagli' };
		const r = m.applyMapping(t, mapping, TODAY);
		expect(r.errors).toEqual([]);
		expect(r.skippedNoDate).toBe(1); // "Saldo contabile"
		expect(r.rows).toEqual([
			{ line: 5, date: '2026-10-02', description: 'ESSELUNGA MILANO', card: 'Carta 1234', amount: -45.3, category: 'Spesa' },
			{ line: 6, date: '2026-10-01', description: 'STIPENDIO ACME', card: 'Conto 5678', amount: 1850, category: null },
			{ line: 7, date: '2026-09-30', description: 'NETFLIX', card: 'Carta 1234', amount: -12.99, category: null }
		]);
	});

	it('Dare/Avere: uscite positive o negative diventano negative; causale + descrizione', () => {
		const t = m.readCsvTable(BANK_B);
		const r = m.applyMapping(t, m.guessMapping(t.headers), TODAY);
		expect(r.errors).toEqual([]);
		expect(r.rows.map((x) => [x.description, x.amount])).toEqual([
			['ENEL ENERGIA ADDEBITO SDD', -80.1],
			['RIMBORSO BONIFICO', 25],
			['CANONE ADDEBITO', -2.5]
		]);
	});

	it('senza "ignora righe senza data" la riga di totale è un errore', () => {
		const t = m.readCsvTable(BANK_A, 3);
		const r = m.applyMapping(t, { ...m.guessMapping(t.headers, 3), description: 'Dettagli', skipInvalidDates: false }, TODAY);
		expect(r.errors).toEqual(['Riga 8: data non valida "Saldo contabile".']);
	});

	it('uscite positive nel file: "inverti segno"', () => {
		const t = m.readCsvTable('Data;Descrizione;Importo\n01/09/2026;Spesa;12,00\n');
		const r = m.applyMapping(t, { ...m.guessMapping(t.headers), invert: true }, TODAY);
		expect(r.rows[0].amount).toBe(-12);
	});

	it('segnala colonne mancanti e date nel futuro', () => {
		const t = m.readCsvTable('Data;Descrizione;Importo\n01/12/2026;X;-1\n');
		expect(m.applyMapping(t, { ...m.EMPTY_MAPPING }, TODAY).errors).toContain('Scegli la colonna della data.');
		expect(m.applyMapping(t, m.guessMapping(t.headers), TODAY).errors).toEqual(['Riga 2: data nel futuro (2026-12-01).']);
		expect(m.mappingProblems({ ...m.guessMapping(t.headers), card: 'Nope' }, t.headers)).toEqual([
			'La colonna "Nope" (card) non c\'è nel file.'
		]);
	});
});

describe('date e importi', () => {
	it('date nei formati comuni, orario ignorato', () => {
		expect(m.parseDateAs('02/10/2026', 'auto')).toBe('2026-10-02');
		expect(m.parseDateAs('2.10.26', 'dmy')).toBe('2026-10-02');
		expect(m.parseDateAs('2026-10-02 14:33:00', 'auto')).toBe('2026-10-02');
		expect(m.parseDateAs('20261002', 'auto')).toBe('2026-10-02');
		expect(m.parseDateAs('10/02/2026', 'mdy')).toBe('2026-10-02');
		expect(m.parseDateAs('31/02/2026', 'auto')).toBeNull();
		expect(m.parseDateAs('Saldo', 'auto')).toBeNull();
	});

	it('importi con migliaia, valuta, segno in coda e parentesi', () => {
		expect(m.parseAmountAs('1.234,56', 'auto')).toBeCloseTo(1234.56);
		expect(m.parseAmountAs('€ -1.234,56', 'comma')).toBeCloseTo(-1234.56);
		expect(m.parseAmountAs('12,50-', 'auto')).toBeCloseTo(-12.5);
		expect(m.parseAmountAs('(12,50)', 'auto')).toBeCloseTo(-12.5);
		expect(m.parseAmountAs('1,234.56', 'dot')).toBeCloseTo(1234.56);
		expect(m.parseAmountAs("1'234.56", 'dot')).toBeCloseTo(1234.56);
		expect(m.parseAmountAs('1.234', 'comma')).toBe(1234); // in un file "con virgola" il punto è migliaia
		expect(m.parseAmountAs('', 'auto')).toBeNaN();
	});
});

describe('profili', () => {
	it('salvati per nome, riconosciuti dall\'intestazione anche dopo righe introduttive', () => {
		const t = m.readCsvTable(BANK_A, 3);
		const mapping = { ...m.guessMapping(t.headers, 3), description: 'Dettagli' };
		m.saveProfile('Banca A', t.headers, mapping);
		m.saveProfile('Banca B', m.readCsvTable(BANK_B).headers, m.guessMapping(m.readCsvTable(BANK_B).headers));
		expect(m.listProfiles().map((p) => p.name)).toEqual(['Banca A', 'Banca B']);

		// stesso formato, altri movimenti e altro preambolo della stessa lunghezza
		const other = BANK_A.replace('Mario Esempio', 'Altro Nome').replace('ESSELUNGA MILANO', 'CONAD');
		const found = m.findProfileFor(other)!;
		expect(found.profile.name).toBe('Banca A');
		expect(found.profile.mapping.description).toBe('Dettagli');
		expect(m.applyMapping(found.table, found.profile.mapping, TODAY).rows[0].description).toBe('CONAD');
		expect(m.findProfileFor('Foo;Bar;Baz\n1;2;3\n')).toBeNull();

		// risalvare aggiorna, eliminare toglie
		m.saveProfile('Banca A', t.headers, { ...mapping, invert: true });
		expect(m.getProfile('Banca A')!.mapping.invert).toBe(true);
		expect(m.deleteProfile('Banca A')).toBe(true);
		expect(m.listProfiles().map((p) => p.name)).toEqual(['Banca B']);
	});

	it('mappatura dal form: valori ammessi soltanto', () => {
		const f = new FormData();
		f.set('m_header_line', '4');
		f.set('m_date', 'Data');
		f.set('m_date_format', 'xxx');
		f.set('m_amount_mode', 'split');
		f.set('m_decimal', 'comma');
		f.set('m_skip_invalid', 'on');
		expect(m.mappingFromForm(f)).toMatchObject({ skipRows: 3, date: 'Data', dateFormat: 'auto', amountMode: 'split', decimal: 'comma', skipInvalidDates: true, invert: false });
	});
});
