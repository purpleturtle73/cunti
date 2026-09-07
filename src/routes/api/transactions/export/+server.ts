import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

/** Export CSV delle transazioni di investimento, stesso formato dell'import
 *  (data;strumento;isin;tipo;quantita;prezzo;commissioni;broker;note — round-trip). */
export const GET: RequestHandler = () => {
	const rows = db
		.prepare(
			`SELECT t.date, i.symbol, i.isin, t.type, t.quantity, t.price, t.fee, b.name AS broker, t.notes
			 FROM transactions t
			 JOIN instruments i ON i.id = t.instrument_id
			 LEFT JOIN brokers b ON b.id = t.broker_id
			 ORDER BY t.date, t.id`
		)
		.all() as {
		date: string;
		symbol: string;
		isin: string | null;
		type: string;
		quantity: number;
		price: number;
		fee: number;
		broker: string | null;
		notes: string | null;
	}[];

	const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
	const lines = ['data;strumento;isin;tipo;quantita;prezzo;commissioni;broker;note'];
	for (const r of rows) {
		lines.push(
			[r.date, esc(r.symbol), esc(r.isin ?? ''), r.type, String(r.quantity), String(r.price), String(r.fee), esc(r.broker ?? ''), esc(r.notes ?? '')].join(';')
		);
	}
	return new Response(lines.join('\n') + '\n', {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="transazioni-${new Date().toISOString().slice(0, 10)}.csv"`
		}
	});
};
