import { json } from '@sveltejs/kit';
import { refreshAll } from '$lib/server/prices';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ url }) => {
	const report = await refreshAll(url.searchParams.get('full') === '1');
	return json(report);
};
