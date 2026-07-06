import { describe, expect, it } from 'vitest';
import { parseTransactionsCsv } from './txcsv';

const instruments = [
	{ id: 1, symbol: 'SWDA.MI' },
	{ id: 2, symbol: 'bitcoin' }
];
const brokers = [
	{ id: 10, name: 'Directa' },
	{ id: 11, name: 'Kraken' }
];

describe('parseTransactionsCsv', () => {
	it('importa righe valide con separatore ; e decimali italiani', () => {
		const csv = [
			'data;strumento;tipo;quantita;prezzo;commissioni;broker;note',
			'2024-01-15;SWDA.MI;acquisto;10;98,54;5,00;Directa;PAC gennaio',
			'15/02/2024;bitcoin;buy;0,5;40000;0;;'
		].join('\n');
		const { rows, errors } = parseTransactionsCsv(csv, instruments, brokers);
		expect(errors).toEqual([]);
		expect(rows).toEqual([
			{
				line: 2,
				instrument_id: 1,
				type: 'buy',
				date: '2024-01-15',
				quantity: 10,
				price: 98.54,
				fee: 5,
				notes: 'PAC gennaio',
				broker_id: 10
			},
			{
				line: 3,
				instrument_id: 2,
				type: 'buy',
				date: '2024-02-15',
				quantity: 0.5,
				price: 40000,
				fee: 0,
				notes: null,
				broker_id: null
			}
		]);
	});

	it('accetta separatore virgola, header con accenti/maiuscole, campi quotati e BOM', () => {
		const csv =
			'\ufeffData,Strumento,Tipo,Quantità,Prezzo,Note\n' +
			'2024-03-01,swda.mi,vendita,3,"1.234,56","vendita, parziale"\n';
		const { rows, errors } = parseTransactionsCsv(csv, instruments, brokers);
		expect(errors).toEqual([]);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			instrument_id: 1,
			type: 'sell',
			price: 1234.56,
			fee: 0,
			notes: 'vendita, parziale'
		});
	});

	it('accetta numeri in formato US (1,234.56)', () => {
		const csv = 'data;strumento;tipo;quantita;prezzo\n2024-03-01;SWDA.MI;buy;1;1,234.56';
		const { rows, errors } = parseTransactionsCsv(csv, instruments, brokers);
		expect(errors).toEqual([]);
		expect(rows[0].price).toBe(1234.56);
	});

	it('segnala colonne obbligatorie mancanti', () => {
		const { rows, errors } = parseTransactionsCsv('data;tipo\n2024-01-01;buy', instruments, brokers);
		expect(rows).toEqual([]);
		expect(errors[0]).toContain('strumento');
		expect(errors[0]).toContain('quantita');
		expect(errors[0]).toContain('prezzo');
	});

	it('segnala errori riga per riga senza bloccare le righe valide', () => {
		const csv = [
			'data;strumento;tipo;quantita;prezzo;broker',
			'2024-01-15;SWDA.MI;buy;10;100;',
			'2024-13-40;SWDA.MI;buy;10;100;', // data invalida
			'2024-01-15;NOPE;buy;10;100;', // strumento sconosciuto
			'2024-01-15;SWDA.MI;swap;10;100;', // tipo invalido
			'2024-01-15;SWDA.MI;buy;-1;100;', // quantità <= 0
			'2024-01-15;SWDA.MI;buy;1;abc;', // prezzo invalido
			'2024-01-15;SWDA.MI;buy;1;100;Sconosciuto', // broker inesistente
			'2999-01-01;SWDA.MI;buy;1;100;' // futuro
		].join('\n');
		const { rows, errors } = parseTransactionsCsv(csv, instruments, brokers);
		expect(rows).toHaveLength(1);
		expect(errors).toHaveLength(7);
		expect(errors[0]).toContain('Riga 3');
		expect(errors.at(-1)).toContain('futuro');
	});

	it('file vuoto o solo header → errore', () => {
		expect(parseTransactionsCsv('', instruments, brokers).errors).toHaveLength(1);
		expect(
			parseTransactionsCsv('data;strumento;tipo;quantita;prezzo', instruments, brokers).errors
		).toHaveLength(1);
	});
});
