import { fail } from '@sveltejs/kit';
import { allInstruments, db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const rows = db
		.prepare(
			`SELECT t.*, i.name AS instrument_name, i.type AS instrument_type
			 FROM transactions t JOIN instruments i ON i.id = t.instrument_id
			 ORDER BY t.date DESC, t.id DESC`
		)
		.all() as {
		id: number;
		instrument_id: number;
		type: 'buy' | 'sell';
		date: string;
		quantity: number;
		price: number;
		fee: number;
		notes: string | null;
		instrument_name: string;
		instrument_type: string;
	}[];
	return { transactions: rows, instruments: allInstruments() };
};

export const actions: Actions = {
	create: async ({ request }) => {
		const form = await request.formData();
		const instrument_id = Number(form.get('instrument_id'));
		const type = String(form.get('type'));
		const date = String(form.get('date'));
		const quantity = Number(String(form.get('quantity')).replace(',', '.'));
		const price = Number(String(form.get('price')).replace(',', '.'));
		const fee = Number(String(form.get('fee') || '0').replace(',', '.'));
		const notes = String(form.get('notes') || '').trim() || null;

		if (!instrument_id || !['buy', 'sell'].includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(date))
			return fail(400, { error: 'Dati mancanti o non validi.' });
		if (!Number.isFinite(quantity) || quantity <= 0) return fail(400, { error: 'Quantità non valida.' });
		if (!Number.isFinite(price) || price < 0) return fail(400, { error: 'Prezzo non valido.' });
		if (!Number.isFinite(fee) || fee < 0) return fail(400, { error: 'Commissione non valida.' });

		db.prepare(
			'INSERT INTO transactions (instrument_id, type, date, quantity, price, fee, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
		).run(instrument_id, type, date, quantity, price, fee, notes);
		return { success: true };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { error: 'ID mancante.' });
		db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
		return { success: true };
	}
};
