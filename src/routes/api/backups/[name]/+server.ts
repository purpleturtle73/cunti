import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { backupPath } from '$lib/server/backup';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params }) => {
	let full: string;
	try {
		full = backupPath(params.name);
	} catch (e) {
		error(404, String(e));
	}
	const stat = fs.statSync(full);
	const stream = Readable.toWeb(fs.createReadStream(full)) as ReadableStream;
	return new Response(stream, {
		headers: {
			'Content-Type': 'application/vnd.sqlite3',
			'Content-Length': String(stat.size),
			'Content-Disposition': `attachment; filename="${params.name}"`
		}
	});
};
