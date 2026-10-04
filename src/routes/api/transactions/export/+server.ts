import { exportTransactionsCsv } from '$lib/server/transactions';
import type { RequestHandler } from './$types';

/** Export CSV delle transazioni di investimento, stesso formato dell'import
 *  (data;strumento;isin;tipo;quantita;prezzo;commissioni;broker;note — round-trip). */
export const GET: RequestHandler = () => {
	const csv = exportTransactionsCsv();
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="transazioni-${new Date().toISOString().slice(0, 10)}.csv"`
		}
	});
};
