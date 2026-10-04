import { fail } from '@sveltejs/kit';
import { allBrokers, allInstruments, db } from '$lib/server/db';
import { buildSnapshot } from '$lib/server/portfolio';
import { buildTaxSummary } from '$lib/server/tax';
import type { Actions, PageServerLoad } from './$types';

export interface TxMarker {
	date: string;
	type: 'buy' | 'sell';
	assetType: 'etf' | 'crypto';
	label: string; // "3 × iShares Core MSCI World (SWDA.MI)"
}

export interface OperationRow {
	id: number;
	instrument_id: number;
	type: 'buy' | 'sell';
	date: string;
	quantity: number;
	price: number;
	fee: number;
	notes: string | null;
	broker_id: number | null;
	instrument_name: string;
	instrument_symbol: string;
	instrument_isin: string | null;
	instrument_type: string;
	currency: string;
	broker_name: string | null;
	broker_has_logo: 0 | 1;
}

function readTxForm(form: FormData) {
	const instrument_id = Number(form.get('instrument_id'));
	const type = String(form.get('type'));
	const date = String(form.get('date'));
	const quantity = Number(String(form.get('quantity')).replace(',', '.'));
	const price = Number(String(form.get('price')).replace(',', '.'));
	const fee = Number(String(form.get('fee') || '0').replace(',', '.'));
	const notes = String(form.get('notes') || '').trim() || null;
	const broker_id = Number(form.get('broker_id')) || null;

	if (!instrument_id || !['buy', 'sell'].includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(date))
		return { error: 'Dati mancanti o non validi.' };
	if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Quantità non valida.' };
	if (!Number.isFinite(price) || price < 0) return { error: 'Prezzo non valido.' };
	if (!Number.isFinite(fee) || fee < 0) return { error: 'Commissione non valida.' };
	if (!db.prepare('SELECT 1 FROM instruments WHERE id = ?').get(instrument_id))
		return { error: 'Strumento non valido.' };
	if (broker_id && !db.prepare('SELECT 1 FROM brokers WHERE id = ?').get(broker_id))
		return { error: 'Broker non valido.' };

	return { values: { instrument_id, type, date, quantity, price, fee, notes, broker_id } };
}

/** Operazioni per pagina nello storico. */
const OPS_PER_PAGE = 100;

export const load: PageServerLoad = ({ url }) => {
	const snapshot = buildSnapshot();
	const brokers = allBrokers();
	const tax = buildTaxSummary(snapshot.positions, new Map(brokers.map((b) => [b.id, b.name])));
	const txMarkers = db
		.prepare(
			`SELECT t.date, t.type, i.type AS assetType,
				(t.quantity || ' × ' || i.name || ' (' || i.symbol || ')') AS label
			 FROM transactions t JOIN instruments i ON i.id = t.instrument_id
			 ORDER BY t.date, t.id`
		)
		.all() as TxMarker[];

	// storico paginato; una pagina fuori intervallo ricade sull'ultima valida
	const total = (db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c;
	const pages = Math.max(1, Math.ceil(total / OPS_PER_PAGE));
	const pageParam = Number.parseInt(url.searchParams.get('pag') ?? '1', 10);
	const page = Math.min(pages, Math.max(1, Number.isFinite(pageParam) ? pageParam : 1));
	const operations = db
		.prepare(
			`SELECT t.*, i.name AS instrument_name, i.symbol AS instrument_symbol,
				i.isin AS instrument_isin, i.type AS instrument_type, i.currency,
				b.name AS broker_name, (b.logo IS NOT NULL) AS broker_has_logo
			 FROM transactions t
			 JOIN instruments i ON i.id = t.instrument_id
			 LEFT JOIN brokers b ON b.id = t.broker_id
			 ORDER BY t.date DESC, t.id DESC
			 LIMIT ? OFFSET ?`
		)
		.all(OPS_PER_PAGE, (page - 1) * OPS_PER_PAGE) as OperationRow[];

	return {
		snapshot,
		tax,
		txMarkers,
		operations,
		opsPagination: { page, pages, total, perPage: OPS_PER_PAGE },
		instruments: allInstruments(),
		brokers
	};
};

const insertTx = () =>
	db.prepare(
		'INSERT INTO transactions (instrument_id, type, date, quantity, price, fee, notes, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	);

export const actions: Actions = {
	create: async ({ request }) => {
		const parsed = readTxForm(await request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error });
		const v = parsed.values;
		insertTx().run(v.instrument_id, v.type, v.date, v.quantity, v.price, v.fee, v.notes, v.broker_id);
		return { success: true };
	},

	update: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id || !db.prepare('SELECT 1 FROM transactions WHERE id = ?').get(id))
			return fail(400, { error: 'Operazione inesistente.' });
		const parsed = readTxForm(form);
		if ('error' in parsed) return fail(400, { error: parsed.error });
		const v = parsed.values;
		db.prepare(
			'UPDATE transactions SET instrument_id = ?, type = ?, date = ?, quantity = ?, price = ?, fee = ?, notes = ?, broker_id = ? WHERE id = ?'
		).run(v.instrument_id, v.type, v.date, v.quantity, v.price, v.fee, v.notes, v.broker_id, id);
		return { success: true };
	},

	duplicate: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { error: 'ID mancante.' });
		const info = db
			.prepare(
				`INSERT INTO transactions (instrument_id, type, date, quantity, price, fee, notes, broker_id)
				 SELECT instrument_id, type, date, quantity, price, fee, notes, broker_id
				 FROM transactions WHERE id = ?`
			)
			.run(id);
		if (info.changes === 0) return fail(400, { error: 'Operazione inesistente.' });
		return { success: true, duplicatedId: Number(info.lastInsertRowid) };
	},

	delete: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { error: 'ID mancante.' });
		db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
		return { success: true };
	}
};
