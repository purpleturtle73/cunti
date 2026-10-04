import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-staging';
fs.rmSync('tmp/test-staging', { recursive: true, force: true });

const { DATA_DIR } = await import('./db');
const { discardStaging, readStaging, writeStaging } = await import('./staging');

const STAGING_ROOT = path.join(DATA_DIR, 'import-staging');

interface Payload {
	rows: number[];
	nota: string;
}

describe('staging generico degli import a due fasi', () => {
	it('round-trip: scrive sotto import-staging/<kind>/ e rilegge il payload identico', () => {
		const payload: Payload = { rows: [1, 2, 3], nota: 'prova' };
		const token = writeStaging('transazioni', payload);

		expect(token).toMatch(/^[0-9a-f-]{36}$/);
		expect(fs.existsSync(path.join(STAGING_ROOT, 'transazioni', `${token}.json`))).toBe(true);
		expect(readStaging<Payload>('transazioni', token)).toEqual(payload);
	});

	it('token di un dominio non è leggibile dall’altro', () => {
		const token = writeStaging('transazioni', { rows: [1], nota: 'tx' });
		expect(readStaging('spese', token)).toBeNull();
		// il file resta dov'è: la lettura sbagliata non lo consuma
		expect(readStaging<Payload>('transazioni', token)).not.toBeNull();
	});

	it('token malformati non lanciano e non escono dalla cartella', () => {
		for (const bad of ['', 'corto', '../../etc/passwd', '../cunti.db']) {
			expect(readStaging('spese', bad)).toBeNull();
			expect(() => discardStaging('spese', bad)).not.toThrow();
		}
	});

	it('token ben formato ma inesistente → null', () => {
		expect(readStaging('spese', '00000000-0000-0000-0000-000000000000')).toBeNull();
	});

	it('discardStaging consuma il token ed è idempotente', () => {
		const token = writeStaging('spese', { rows: [], nota: '' });
		discardStaging('spese', token);
		expect(readStaging('spese', token)).toBeNull();
		expect(() => discardStaging('spese', token)).not.toThrow();
	});

	it('la pulizia pigra elimina gli staging scaduti e risparmia i validi', () => {
		const stale = writeStaging('transazioni', { rows: [9], nota: 'vecchio' });
		const stalePath = path.join(STAGING_ROOT, 'transazioni', `${stale}.json`);
		const old = new Date(Date.now() - 2 * 60 * 60 * 1000); // oltre il TTL di 1h
		fs.utimesSync(stalePath, old, old);

		// una nuova scrittura fa scattare la pulizia
		const fresh = writeStaging('transazioni', { rows: [10], nota: 'nuovo' });

		expect(fs.existsSync(stalePath)).toBe(false);
		expect(readStaging('transazioni', stale)).toBeNull();
		expect(readStaging<Payload>('transazioni', fresh)).not.toBeNull();
	});

	it('la pulizia raccoglie anche i file sciolti del vecchio layout (senza sottocartella)', () => {
		fs.mkdirSync(STAGING_ROOT, { recursive: true });
		const legacy = path.join(STAGING_ROOT, 'aaaaaaaa-0000-0000-0000-000000000000.json');
		fs.writeFileSync(legacy, JSON.stringify({ rows: [], conflicts: [] }));
		const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
		fs.utimesSync(legacy, old, old);

		writeStaging('spese', { rows: [], nota: '' });

		expect(fs.existsSync(legacy)).toBe(false);
	});
});
