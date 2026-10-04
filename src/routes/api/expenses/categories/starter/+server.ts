import { STARTER_CATEGORIES } from '$lib/server/starter-categories';
import type { RequestHandler } from './$types';

/** Il set di categorie suggerito, da scaricare e personalizzare prima di importarlo. */
export const GET: RequestHandler = () =>
	new Response(JSON.stringify(STARTER_CATEGORIES, null, 2) + '\n', {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': 'attachment; filename="categorie-suggerite.json"'
		}
	});
