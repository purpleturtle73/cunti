import { building } from '$app/environment';
import { startBackupScheduler } from '$lib/server/backup';
import { startScheduler } from '$lib/server/prices';

declare global {
	// eslint-disable-next-line no-var
	var __priceScheduler: boolean | undefined;
}

if (!building && !globalThis.__priceScheduler) {
	globalThis.__priceScheduler = true;
	startScheduler();
	startBackupScheduler();
}
