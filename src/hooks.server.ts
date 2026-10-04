import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { startBackupScheduler } from '$lib/server/backup';
import { DATA_DIR } from '$lib/server/db';
import { log } from '$lib/server/log';
import { startScheduler } from '$lib/server/prices';
import { APP_VERSION } from '$lib/server/version';

declare global {
	// eslint-disable-next-line no-var
	var __priceScheduler: boolean | undefined;
}

if (!building && !globalThis.__priceScheduler) {
	globalThis.__priceScheduler = true;
	log('server', `avvio: versione=${APP_VERSION} DATA_DIR=${DATA_DIR} PORT=${process.env.PORT ?? '3030'}`);
	startScheduler();
	startBackupScheduler();
}

// Access log: un rigo per richiesta (metodo, path, status, durata). Gli asset
// statici (_app/, favicon…) sono già serviti da adapter-node prima di arrivare
// qui, quindi non sporcano il log.
export const handle: Handle = async ({ event, resolve }) => {
	const start = Date.now();
	const response = await resolve(event);
	log(
		'http',
		`${event.request.method} ${event.url.pathname}${event.url.search} → ${response.status} (${Date.now() - start}ms)`
	);
	return response;
};
