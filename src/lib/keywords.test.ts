import { describe, expect, it } from 'vitest';
import { suggestKeyword } from './keywords';

describe('suggestKeyword — keyword da una descrizione bancaria', () => {
	it("salta il tipo di operazione e prende l'esercente", () => {
		expect(suggestKeyword('PAGAMENTO POS ESSELUNGA MILANO 1234')).toBe('esselunga');
		expect(suggestKeyword('ADDEBITO SDD FASTWEB SPA FIBRA')).toBe('fastweb');
		expect(suggestKeyword('ACCREDITO STIPENDIO ACME SRL 09/2026')).toBe('stipendio');
		expect(suggestKeyword('NETFLIX.COM AMSTERDAM')).toBe('netflix.com');
	});

	it('un nome corto si allunga con la parola successiva', () => {
		expect(suggestKeyword('ADDEBITO SDD ENEL ENERGIA BOLLETTA')).toBe('enel energia');
		expect(suggestKeyword('PAGAMENTO POS BAR SPORT 77')).toBe('bar sport');
	});

	it('si ferma a numeri e riferimenti', () => {
		expect(suggestKeyword('PAGAMENTO POS ESERCENTE 516')).toBe('esercente');
		expect(suggestKeyword("MCDONALD'S 512")).toBe("mcdonald's");
	});

	it('il risultato è sempre un pezzo della descrizione, anche con spazi doppi', () => {
		for (const d of ['PAGAMENTO  POS   ENI  STATION  44', 'BONIFICO A FAVORE DI  MARIO  ROSSI', 'Spesa  Coop  Centro'])
			expect(d.toLowerCase()).toContain(suggestKeyword(d));
	});

	it('senza parole utili ripiega sulla descrizione', () => {
		expect(suggestKeyword('POS 1234')).toBe('pos 1234');
	});
});
