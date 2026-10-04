import { exportCategories } from '$lib/server/categorize';
import type { RequestHandler } from './$types';

/** Categorie e keyword attuali in JSON, reimportabile da Admin → Finanze → Categorie. */
export const GET: RequestHandler = () =>
	new Response(JSON.stringify(exportCategories(), null, 2) + '\n', {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="categorie-${new Date().toISOString().slice(0, 10)}.json"`
		}
	});
