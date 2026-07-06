import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	const row = db
		.prepare('SELECT logo, logo_mime FROM brokers WHERE id = ?')
		.get(Number(params.id)) as { logo: Buffer | null; logo_mime: string | null } | undefined;
	if (!row?.logo || !row.logo_mime) error(404, 'Logo non presente');
	return new Response(new Uint8Array(row.logo), {
		headers: {
			'Content-Type': row.logo_mime,
			'Cache-Control': 'private, max-age=300'
		}
	});
};
