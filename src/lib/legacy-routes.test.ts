import { describe, expect, it } from 'vitest';
import { redirectTarget } from './legacy-routes';

describe('redirectTarget — vecchi indirizzi', () => {
	it('la home porta a Finanze con un redirect temporaneo', () => {
		expect(redirectTarget('/')).toEqual({ location: '/finanze', status: 307 });
	});

	it('mappa le vecchie pagine sulle nuove, sottopagine comprese', () => {
		expect(redirectTarget('/spese')?.location).toBe('/finanze');
		expect(redirectTarget('/transactions')?.location).toBe('/investimenti');
		expect(redirectTarget('/instruments')?.location).toBe('/admin/investimenti');
		expect(redirectTarget('/admin/transazioni')?.location).toBe('/admin/investimenti');
		expect(redirectTarget('/admin/spese/categorie')).toEqual({ location: '/admin/finanze/categorie', status: 301 });
		expect(redirectTarget('/admin/spese/conflitti')?.location).toBe('/admin/finanze/conflitti');
	});

	it('non tocca le pagine nuove né i prefissi solo simili', () => {
		for (const p of ['/finanze', '/investimenti', '/admin', '/admin/finanze', '/positions/3', '/spesex', '/api/expenses/export'])
			expect(redirectTarget(p)).toBeNull();
	});
});
