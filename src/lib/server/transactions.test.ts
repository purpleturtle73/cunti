import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-transactions';
fs.rmSync('tmp/test-transactions', { recursive: true, force: true });

const { DATA_DIR, allBrokers, allInstruments, db } = await import('./db');
const { applyStaging } = await import('./expenses');
const { writeStaging } = await import('./staging');
const {
	PREVIEW_ROWS,
	applyTxStaging,
	discardTxStaging,
	exportTransactionsCsv,
	stageTxImport,
	wipeTransactions
} = await import('./transactions');
const { parseTransactionsCsv } = await import('./txcsv');

const HEADER = 'data;strumento;isin;tipo;quantita;prezzo;commissioni;broker;note';

/** Parsa righe CSV come farebbe l'action di import. */
function parse(...dataLines: string[]) {
	const { rows, errors } = parseTransactionsCsv(
		[HEADER, ...dataLines].join('\n'),
		allInstruments(),
		allBrokers()
	);
	expect(errors).toEqual([]);
	return rows;
}

const count = () =>
	(db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n;

beforeAll(() => {
	db.prepare(
		"INSERT INTO instruments (symbol, name, type, isin, ter_pct, tax_rate_pct, currency) VALUES ('SWDA.MI', 'iShares Core MSCI World', 'etf', 'IE00B4L5Y983', 0.2, 26, 'EUR')"
	).run();
	db.prepare(
		"INSERT INTO instruments (symbol, name, type, ter_pct, tax_rate_pct, currency) VALUES ('bitcoin', 'Bitcoin', 'crypto', 0, 26, 'USD')"
	).run();
	db.prepare("INSERT INTO brokers (name) VALUES ('Directa')").run();
	db.prepare('INSERT INTO prices (instrument_id, date, close) VALUES (1, ?, ?)').run(
		'2026-01-02',
		100
	);
});

describe('stageTxImport — anteprima senza scritture', () => {
	it('mette in staging le righe nuove senza toccare il DB', () => {
		const p = stageTxImport(parse('2026-01-02;SWDA.MI;;acquisto;10;98,54;5;Directa;PAC'));

		expect(p.token).toMatch(/^[0-9a-f-]{36}$/);
		expect(p.total).toBe(1);
		expect(p.toInsert).toBe(1);
		expect(p.skippedDuplicates).toBe(0);
		expect(count()).toBe(0); // niente sul DB prima della conferma

		discardTxStaging(p.token);
	});

	it('risolve ticker, valuta e broker per rendere leggibile l’anteprima', () => {
		const p = stageTxImport(parse('2026-01-05;bitcoin;;buy;0,5;40000;0;Directa;'));

		expect(p.rows[0]).toMatchObject({
			symbol: 'bitcoin',
			currency: 'USD',
			broker: 'Directa',
			type: 'buy',
			quantity: 0.5
		});
		discardTxStaging(p.token);
	});

	it('conta i doppioni interni al file', () => {
		const p = stageTxImport(
			parse(
				'2026-01-02;SWDA.MI;;acquisto;10;98,54;5;;',
				'2026-01-02;SWDA.MI;;acquisto;10;98,54;5;;' // identica alla precedente
			)
		);

		expect(p.toInsert).toBe(1);
		expect(p.skippedDuplicates).toBe(1);
		expect(p.skippedLines).toEqual([3]);
		discardTxStaging(p.token);
	});

	it('tronca le righe mostrate ma mette in staging tutte quelle da inserire', () => {
		const many = Array.from(
			{ length: PREVIEW_ROWS + 5 },
			(_, i) => `2026-02-${String((i % 28) + 1).padStart(2, '0')};SWDA.MI;;buy;${i + 1};100;0;;`
		);
		const p = stageTxImport(parse(...many));

		expect(p.toInsert).toBe(PREVIEW_ROWS + 5);
		expect(p.rows).toHaveLength(PREVIEW_ROWS);
		expect(p.truncated).toBe(5);

		expect(applyTxStaging(p.token)?.inserted).toBe(PREVIEW_ROWS + 5);
		db.prepare('DELETE FROM transactions').run();
	});
});

describe('applyTxStaging — conferma', () => {
	it('inserisce le righe e consuma il token', () => {
		const p = stageTxImport(
			parse(
				'2026-01-02;SWDA.MI;;acquisto;10;98,54;5;Directa;PAC',
				'2026-01-09;SWDA.MI;;acquisto;3;99;1,5;;'
			)
		);

		expect(applyTxStaging(p.token)).toEqual({ inserted: 2, skipped: 0 });
		expect(count()).toBe(2);
		expect(applyTxStaging(p.token)).toBeNull(); // token già consumato
		expect(count()).toBe(2); // nessun doppio inserimento
	});

	it('reimport dello stesso file: tutto duplicato, niente inserito', () => {
		const rows = parse(
			'2026-01-02;SWDA.MI;;acquisto;10;98,54;5;Directa;PAC',
			'2026-01-09;SWDA.MI;;acquisto;3;99;1,5;;'
		);
		const p = stageTxImport(rows);

		expect(p.toInsert).toBe(0);
		expect(p.skippedDuplicates).toBe(2);
		expect(applyTxStaging(p.token)).toEqual({ inserted: 0, skipped: 0 });
		expect(count()).toBe(2);
	});

	it('ri-deduplica alla conferma se il DB è cambiato dopo l’anteprima', () => {
		const before = count();
		const p = stageTxImport(parse('2026-03-01;SWDA.MI;;buy;7;101;0;;'));
		expect(p.toInsert).toBe(1);

		// la stessa operazione viene inserita a mano tra anteprima e conferma
		db.prepare(
			'INSERT INTO transactions (instrument_id, type, date, quantity, price, fee) VALUES (1, ?, ?, ?, ?, ?)'
		).run('buy', '2026-03-01', 7, 101, 0);

		expect(applyTxStaging(p.token)).toEqual({ inserted: 0, skipped: 1 });
		expect(count()).toBe(before + 1); // solo quella inserita a mano
	});

	it('annulla: dopo discard il token non è più applicabile', () => {
		const before = count();
		const p = stageTxImport(parse('2026-04-01;SWDA.MI;;buy;1;100;0;;'));
		discardTxStaging(p.token);

		expect(applyTxStaging(p.token)).toBeNull();
		expect(count()).toBe(before);
	});

	it('token inesistente o di dominio sbagliato → null', () => {
		expect(applyTxStaging('00000000-0000-0000-0000-000000000000')).toBeNull();

		// un token spese non deve essere applicabile come transazioni, e viceversa
		const speseToken = writeStaging('spese', { rows: [], conflicts: [] });
		expect(applyTxStaging(speseToken)).toBeNull();

		const p = stageTxImport(parse('2026-05-01;SWDA.MI;;buy;2;100;0;;'));
		expect(applyStaging(p.token, new Set())).toBeNull();
		discardTxStaging(p.token);
	});
});

describe('exportTransactionsCsv', () => {
	it('round-trip: reimportare l’export non produce nulla di nuovo', () => {
		const csv = exportTransactionsCsv();
		expect(csv.split('\n')[0]).toBe(HEADER);

		const { rows, errors } = parseTransactionsCsv(csv, allInstruments(), allBrokers());
		expect(errors).toEqual([]);
		expect(rows).toHaveLength(count());

		const p = stageTxImport(rows);
		expect(p.toInsert).toBe(0);
		expect(p.skippedDuplicates).toBe(count());
		discardTxStaging(p.token);
	});
});

describe('wipeTransactions', () => {
	it('svuota le transazioni, crea un backup e lascia intatta l’anagrafica', async () => {
		const before = count();
		expect(before).toBeGreaterThan(0);
		const instrumentsBefore = (
			db.prepare('SELECT COUNT(*) AS n FROM instruments').get() as { n: number }
		).n;
		const pricesBefore = (db.prepare('SELECT COUNT(*) AS n FROM prices').get() as { n: number }).n;
		const brokersBefore = (db.prepare('SELECT COUNT(*) AS n FROM brokers').get() as { n: number }).n;

		expect(await wipeTransactions()).toBe(before);
		expect(count()).toBe(0);

		// strumenti, storico prezzi e broker restano: servono al reimport
		expect((db.prepare('SELECT COUNT(*) AS n FROM instruments').get() as { n: number }).n).toBe(
			instrumentsBefore
		);
		expect((db.prepare('SELECT COUNT(*) AS n FROM prices').get() as { n: number }).n).toBe(
			pricesBefore
		);
		expect((db.prepare('SELECT COUNT(*) AS n FROM brokers').get() as { n: number }).n).toBe(
			brokersBefore
		);

		const backups = fs
			.readdirSync(path.join(DATA_DIR, 'backups'))
			.filter((f) => f.endsWith('.db'));
		expect(backups.length).toBeGreaterThan(0);
	});
});
