import { fail } from '@sveltejs/kit';
import { allInstruments, db, type Instrument } from '$lib/server/db';
import { refreshInstrument } from '$lib/server/prices';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const instruments = db
		.prepare(
			`SELECT i.*,
				(SELECT COUNT(*) FROM transactions t WHERE t.instrument_id = i.id) AS tx_count,
				(SELECT COUNT(*) FROM prices p WHERE p.instrument_id = i.id) AS price_count,
				(SELECT MAX(date) FROM prices p WHERE p.instrument_id = i.id) AS last_price_date
			 FROM instruments i ORDER BY i.name`
		)
		.all() as (Instrument & { tx_count: number; price_count: number; last_price_date: string | null })[];
	return { instruments };
};

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const type = String(form.get('type'));
		const symbol = String(form.get('symbol') || '').trim();
		const name = String(form.get('name') || '').trim();
		const isin = String(form.get('isin') || '').trim() || null;
		const ter_pct = Number(String(form.get('ter_pct') || '0').replace(',', '.'));
		const tax_rate_pct = Number(String(form.get('tax_rate_pct') || '26').replace(',', '.'));

		if (!['etf', 'crypto'].includes(type) || !symbol || !name)
			return fail(400, { error: 'Tipo, simbolo e nome sono obbligatori.' });
		if (!Number.isFinite(ter_pct) || ter_pct < 0 || ter_pct > 5)
			return fail(400, { error: 'TER non valido (0–5%).' });
		if (!Number.isFinite(tax_rate_pct) || tax_rate_pct < 0 || tax_rate_pct > 50)
			return fail(400, { error: 'Aliquota non valida.' });

		try {
			const info = db
				.prepare(
					'INSERT INTO instruments (symbol, name, type, isin, ter_pct, tax_rate_pct) VALUES (?, ?, ?, ?, ?, ?)'
				)
				.run(symbol, name, type, isin, ter_pct, tax_rate_pct);

			const inst = db
				.prepare('SELECT * FROM instruments WHERE id = ?')
				.get(info.lastInsertRowid) as Instrument;
			// full history download; report errors on the page instead of failing the insert
			try {
				await refreshInstrument(inst, true);
			} catch (e) {
				return {
					success: true,
					warning: `Strumento creato, ma il download prezzi è fallito: ${String(e)}. Controlla il simbolo e usa "Aggiorna prezzi".`
				};
			}
			return { success: true };
		} catch (e) {
			if (String(e).includes('UNIQUE')) return fail(400, { error: 'Simbolo già presente.' });
			throw e;
		}
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { error: 'ID mancante.' });
		db.prepare('DELETE FROM instruments WHERE id = ?').run(id);
		return { success: true };
	},

	update: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const ter_pct = Number(String(form.get('ter_pct') || '0').replace(',', '.'));
		const tax_rate_pct = Number(String(form.get('tax_rate_pct') || '26').replace(',', '.'));
		if (!id || !Number.isFinite(ter_pct) || !Number.isFinite(tax_rate_pct))
			return fail(400, { error: 'Dati non validi.' });
		db.prepare('UPDATE instruments SET ter_pct = ?, tax_rate_pct = ? WHERE id = ?').run(
			ter_pct,
			tax_rate_pct,
			id
		);
		return { success: true };
	}
};
