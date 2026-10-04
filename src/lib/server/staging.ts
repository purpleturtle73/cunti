/**
 * Staging degli import a due fasi: il file caricato viene parsato e messo da parte
 * con un token, l'anteprima mostra cosa succederebbe, e solo la conferma scrive sul DB.
 *
 * Il payload è opaco per questo modulo: la forma la decide il dominio (spese o
 * transazioni). Lo staging è indicizzato per `kind`, in sottocartelle separate, così
 * un token di un dominio non può essere letto come staging dell'altro.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db';

/** Domini che usano lo staging. Ognuno ha la sua sottocartella. */
export type StagingKind = 'spese' | 'transazioni';

// Funzioni, non costanti: i test impostano DATA_DIR prima dell'import del modulo db.
const STAGING_ROOT = () => path.join(DATA_DIR, 'import-staging');
const STAGING_DIR = (kind: StagingKind) => path.join(STAGING_ROOT(), kind);

const STAGING_TTL_MS = 60 * 60 * 1000; // 1 ora
const TOKEN_RE = /^[0-9a-f-]{36}$/; // forma UUID: anche guardia contro path traversal

const KINDS: StagingKind[] = ['spese', 'transazioni'];

function stagingPath(kind: StagingKind, token: string): string | null {
	if (!TOKEN_RE.test(token)) return null;
	return path.join(STAGING_DIR(kind), `${token}.json`);
}

function removeIfStale(p: string) {
	try {
		if (Date.now() - fs.statSync(p).mtimeMs > STAGING_TTL_MS) fs.rmSync(p, { force: true });
	} catch {
		/* file sparito nel frattempo */
	}
}

/** Elimina gli staging scaduti di tutti i domini. Pulizia pigra: gira a ogni nuovo staging. */
function cleanStale() {
	for (const kind of KINDS) {
		try {
			for (const f of fs.readdirSync(STAGING_DIR(kind))) removeIfStale(path.join(STAGING_DIR(kind), f));
		} catch {
			/* cartella assente */
		}
	}
	// Residui della versione precedente, quando gli staging spese stavano
	// direttamente in import-staging/ senza sottocartella per dominio.
	try {
		for (const f of fs.readdirSync(STAGING_ROOT(), { withFileTypes: true })) {
			if (f.isFile() && f.name.endsWith('.json')) removeIfStale(path.join(STAGING_ROOT(), f.name));
		}
	} catch {
		/* cartella assente */
	}
}

/** Salva il payload e ritorna il token da passare alla fase di conferma. */
export function writeStaging<T>(kind: StagingKind, payload: T): string {
	cleanStale();
	fs.mkdirSync(STAGING_DIR(kind), { recursive: true });
	const token = crypto.randomUUID();
	fs.writeFileSync(path.join(STAGING_DIR(kind), `${token}.json`), JSON.stringify(payload));
	return token;
}

/** Rilegge il payload. `null` se il token è malformato, scaduto o già consumato. */
export function readStaging<T>(kind: StagingKind, token: string): T | null {
	const p = stagingPath(kind, token);
	if (!p) return null;
	try {
		return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
	} catch {
		return null;
	}
}

export function discardStaging(kind: StagingKind, token: string) {
	const p = stagingPath(kind, token);
	if (p) fs.rmSync(p, { force: true });
}
