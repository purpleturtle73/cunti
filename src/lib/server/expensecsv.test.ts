import { describe, expect, it } from 'vitest';
import { parseExpensesCsv } from './expensecsv';

describe('parseExpensesCsv', () => {
	it('parsa il formato completo dello storico (colonne derivate presenti)', () => {
		const csv = [
			'data_ops;descrizione;card;importo;moneyin;moneyout;categoria',
			'31/01/2026;Esselunga Pagamento Con Carta Di Debito;conto;-15.83;0;15.83;supermercato',
			'30/01/2026;"Stipendi E Pensioni Da: Azienda S.r.l""";conto;1234.56;1234.56;0;stipendio'
		].join('\n');
		const { rows, errors } = parseExpensesCsv(csv);
		expect(errors).toEqual([]);
		expect(rows).toEqual([
			{
				line: 2,
				date: '2026-01-31',
				description: 'Esselunga Pagamento Con Carta Di Debito',
				card: 'conto',
				amount: -15.83,
				category: 'supermercato'
			},
			{
				line: 3,
				date: '2026-01-30',
				description: 'Stipendi E Pensioni Da: Azienda S.r.l"',
				card: 'conto',
				amount: 1234.56,
				category: 'stipendio'
			}
		]);
	});

	it('accetta il formato grezzo minimo (solo data, descrizione, importo)', () => {
		const csv = 'data_ops;descrizione;importo\n15/03/2025;Bar Rossi;-4,50';
		const { rows, errors } = parseExpensesCsv(csv);
		expect(errors).toEqual([]);
		expect(rows[0]).toMatchObject({ date: '2025-03-15', card: null, amount: -4.5, category: null });
	});

	it('ignora colonne extra (data_valuta) e accetta header "data"', () => {
		const csv = 'data_valuta;data;descrizione;importo\n01/02/2025;02/02/2025;Taxi;-10';
		const { rows, errors } = parseExpensesCsv(csv);
		expect(errors).toEqual([]);
		expect(rows[0].date).toBe('2025-02-02');
	});

	it('categoria vuota o unknown → null (da categorizzare)', () => {
		const csv =
			'data_ops;descrizione;importo;categoria\n01/02/2025;A;-1;unknown\n01/02/2025;B;-1;\n01/02/2025;C;-1;bollette';
		const { rows } = parseExpensesCsv(csv);
		expect(rows.map((r) => r.category)).toEqual([null, null, 'bollette']);
	});

	it('segnala incoerenza importo vs moneyin/moneyout', () => {
		const csv = 'data_ops;descrizione;importo;moneyin;moneyout\n01/02/2025;A;-5;0;4.00';
		const { rows, errors } = parseExpensesCsv(csv);
		expect(rows).toHaveLength(0);
		expect(errors[0]).toContain('incoerenza');
	});

	it('errori riga per riga: data invalida, futura, descrizione vuota, importo invalido', () => {
		const csv = [
			'data_ops;descrizione;importo',
			'2025-13-01;A;-1',
			'01/01/2999;B;-1',
			'01/02/2025;;-1',
			'01/02/2025;D;abc',
			'01/02/2025;E;-2'
		].join('\n');
		const { rows, errors } = parseExpensesCsv(csv);
		expect(rows).toHaveLength(1);
		expect(errors).toHaveLength(4);
	});

	it('intestazione senza colonne obbligatorie → errore', () => {
		const { errors } = parseExpensesCsv('descrizione;importo\nA;-1');
		expect(errors[0]).toContain('data_ops');
	});
});
