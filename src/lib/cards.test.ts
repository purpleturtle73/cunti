import { describe, expect, it } from 'vitest';
import { cardGroupLabel, matchCard, normCardName } from './cards';

const CARDS = [{ name: 'Mastercard' }, { name: 'VISA' }, { name: 'conto' }];

describe('matchCard — abbinamento per prefisso', () => {
	it('abbina il brand ignorando numero di carta e maiuscole', () => {
		expect(matchCard('MASTERCARD - 1234', CARDS)?.name).toBe('Mastercard');
		expect(matchCard('mastercard - 9999', CARDS)?.name).toBe('Mastercard');
		expect(matchCard('VISA - 5678', CARDS)?.name).toBe('VISA');
	});

	it('abbina anche il valore identico al nome configurato', () => {
		expect(matchCard('conto', CARDS)?.name).toBe('conto');
		expect(matchCard('Conto', CARDS)?.name).toBe('conto');
	});

	it('a parità vince il nome più lungo', () => {
		const cards = [{ name: 'MASTERCARD' }, { name: 'MASTERCARD GOLD' }];
		expect(matchCard('MASTERCARD GOLD - 1', cards)?.name).toBe('MASTERCARD GOLD');
		expect(matchCard('MASTERCARD - 1', cards)?.name).toBe('MASTERCARD');
	});

	it('non abbina quando il nome non è un prefisso', () => {
		expect(matchCard('Bancomat Beta', CARDS)).toBeUndefined();
		// il prefisso va dal nome configurato al valore, non viceversa:
		// la card "Mastercard" non viene abbinata dal valore "Master"
		expect(matchCard('Master', CARDS)).toBeUndefined();
	});

	it('valori e nomi vuoti non abbinano nulla', () => {
		expect(matchCard('', CARDS)).toBeUndefined();
		expect(matchCard('   ', CARDS)).toBeUndefined();
		expect(matchCard('MASTERCARD - 1234', [{ name: '' }, { name: '  ' }])).toBeUndefined();
	});

	it('normCardName normalizza spazi e maiuscole', () => {
		expect(normCardName('  MASTER   card  ')).toBe('master card');
	});
});

describe('cardGroupLabel — etichetta di raggruppamento', () => {
	it('usa il nome configurato quando abbinato', () => {
		expect(cardGroupLabel('MASTERCARD - 1234', CARDS)).toBe('Mastercard');
		expect(cardGroupLabel('MASTERCARD - 2222', CARDS)).toBe('Mastercard');
	});

	it('tiene il valore grezzo quando nessuna card è abbinata', () => {
		expect(cardGroupLabel('BancomatAlfa', CARDS)).toBe('BancomatAlfa');
		expect(cardGroupLabel('BancomatAlfa', [])).toBe('BancomatAlfa');
	});
});
