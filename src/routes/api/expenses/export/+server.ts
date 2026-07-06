import { exportExpensesCsv } from '$lib/server/expenses';
import type { RequestHandler } from './$types';

/** Export CSV completo delle spese, stesso formato dell'import (round-trip). */
export const GET: RequestHandler = () => {
	const csv = exportExpensesCsv();
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="spese-${new Date().toISOString().slice(0, 10)}.csv"`
		}
	});
};
