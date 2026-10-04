import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { APP_VERSION } from '$lib/server/version';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	try {
		db.prepare('SELECT 1').get();
		return json({ status: 'ok', version: APP_VERSION });
	} catch (e) {
		return json({ status: 'error', version: APP_VERSION, error: String(e) }, { status: 500 });
	}
};
