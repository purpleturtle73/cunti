/** Logging minimale su stdout/stderr con timestamp e scope.
 *  In container i log si leggono con `podman logs -f cunti` o
 *  `journalctl --user -u cunti.service -f`; in sviluppo nel terminale di `npm run dev`. */

function line(scope: string, msg: string): string {
	return `${new Date().toISOString()} [${scope}] ${msg}`;
}

export function log(scope: string, msg: string) {
	console.log(line(scope, msg));
}

export function logError(scope: string, msg: string, err?: unknown) {
	console.error(line(scope, err !== undefined ? `${msg}: ${String(err)}` : msg));
}
