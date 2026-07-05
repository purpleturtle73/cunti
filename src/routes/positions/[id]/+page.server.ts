import { error } from '@sveltejs/kit';
import { db, priceHistory, type Instrument, type Transaction } from '$lib/server/db';
import { buildPosition } from '$lib/server/portfolio';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const instrument = db.prepare('SELECT * FROM instruments WHERE id = ?').get(Number(params.id)) as
		| Instrument
		| undefined;
	if (!instrument) error(404, 'Strumento non trovato');

	const txs = db
		.prepare('SELECT * FROM transactions WHERE instrument_id = ? ORDER BY date, id')
		.all(instrument.id) as Transaction[];

	const position = buildPosition(instrument, txs);

	// daily value series for this position
	const history = priceHistory(instrument.id);
	const series: { date: string; value: number; invested: number }[] = [];
	if (txs.length > 0) {
		const start = txs[0].date;
		const end = new Date().toISOString().slice(0, 10);
		let qty = 0;
		let invested = 0;
		let i = 0;
		let lastPx = history.values().next().done ? 0 : history.values().next().value!;
		const d = new Date(start + 'T00:00:00Z');
		for (let day = start; day <= end; ) {
			while (i < txs.length && txs[i].date <= day) {
				const tx = txs[i];
				if (tx.type === 'buy') {
					qty += tx.quantity;
					invested += tx.quantity * tx.price + tx.fee;
				} else {
					qty = Math.max(0, qty - tx.quantity);
					invested -= tx.quantity * tx.price - tx.fee;
				}
				i++;
			}
			const px = history.get(day);
			if (px != null) lastPx = px;
			series.push({ date: day, value: qty * lastPx, invested });
			d.setUTCDate(d.getUTCDate() + 1);
			day = d.toISOString().slice(0, 10);
		}
	}

	return { instrument, position, txs: [...txs].reverse(), series };
};
