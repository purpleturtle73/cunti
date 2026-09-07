import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR, db, getSetting, setSetting } from './db';
import { log, logError } from './log';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RETENTION_DAYS = 10;
const NAME_RE = /^cunti-\d{8}-\d{6,9}\.db$/;
// Nomi ammessi per il restore: backup generati o file caricati (sanificati in saveUploadedBackup)
const RESTORE_RE = /^[A-Za-z0-9._-]+\.db$/;

export interface BackupInfo {
	name: string;
	size: number;
	mtime: string; // ISO
}

function stamp(d = new Date()): string {
	const p = (n: number, w = 2) => String(n).padStart(w, '0');
	// millisecondi inclusi: evita collisioni di nome per backup ravvicinati
	return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`;
}

/** Elimina i backup automatici più vecchi di RETENTION_DAYS giorni. */
function rotate() {
	const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
	for (const f of fs.readdirSync(BACKUP_DIR)) {
		if (!NAME_RE.test(f)) continue; // non toccare file caricati a mano
		const full = path.join(BACKUP_DIR, f);
		if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
	}
}

/** I file di configurazione testuali (regole/meta categorie spese) vivono fuori dal DB:
 *  a ogni backup se ne salva l'ultima copia in backups/ (sovrascritta, non ruotata). */
function copyConfigFiles() {
	for (const f of ['categories.json', 'categories-meta.json']) {
		const src = path.join(DATA_DIR, f);
		if (fs.existsSync(src)) fs.copyFileSync(src, path.join(BACKUP_DIR, f));
	}
}

/** Backup online (SQLite backup API: consistente anche con WAL attivo). */
export async function createBackup(): Promise<BackupInfo> {
	fs.mkdirSync(BACKUP_DIR, { recursive: true });
	const name = `cunti-${stamp()}.db`;
	const full = path.join(BACKUP_DIR, name);
	await db.backup(full);
	setSetting('last_backup', new Date().toISOString());
	rotate();
	copyConfigFiles();
	const st = fs.statSync(full);
	log('backup', `creato ${name} (${st.size} byte)`);
	return { name, size: st.size, mtime: st.mtime.toISOString() };
}

export function listBackups(): BackupInfo[] {
	if (!fs.existsSync(BACKUP_DIR)) return [];
	return fs
		.readdirSync(BACKUP_DIR)
		.filter((f) => RESTORE_RE.test(f))
		.map((name) => {
			const st = fs.statSync(path.join(BACKUP_DIR, name));
			return { name, size: st.size, mtime: st.mtime.toISOString() };
		})
		.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** Path del backup, validando il nome (no traversal). */
export function backupPath(name: string): string {
	if (!RESTORE_RE.test(name)) throw new Error('Nome backup non valido');
	const full = path.resolve(BACKUP_DIR, name);
	if (path.dirname(full) !== path.resolve(BACKUP_DIR)) throw new Error('Nome backup non valido');
	if (!fs.existsSync(full)) throw new Error('Backup non trovato');
	return full;
}

export function deleteBackup(name: string) {
	fs.unlinkSync(backupPath(name));
	log('backup', `eliminato ${name}`);
}

/** Salva un file .db caricato dall'utente nella cartella backup (nome sanificato). */
export function saveUploadedBackup(originalName: string, data: Buffer): string {
	fs.mkdirSync(BACKUP_DIR, { recursive: true });
	const base = path
		.basename(originalName)
		.replace(/\.db$/i, '')
		.replace(/[^A-Za-z0-9._-]/g, '_')
		.slice(0, 60);
	const name = `upload-${base || 'backup'}-${stamp()}.db`;
	fs.writeFileSync(path.join(BACKUP_DIR, name), data);
	log('backup', `upload salvato come ${name} (${data.length} byte)`);
	return name;
}

// Tabelle copiate nel restore, in ordine FK-safe (genitori prima dei figli)
const TABLES = ['settings', 'brokers', 'instruments', 'transactions', 'prices', 'fx_rates'];

/** Ripristina un backup nel DB vivo: svuota le tabelle e copia le righe dal file,
 *  in un'unica transazione (ATTACH). Copia solo le colonne in comune, così un
 *  backup di una versione precedente dello schema resta ripristinabile. */
export function restoreBackup(name: string) {
	log('backup', `restore da ${name} avviato`);
	const full = backupPath(name);

	// Verifica preliminare: è un DB SQLite con le tabelle attese?
	const src = new Database(full, { readonly: true });
	let srcTables: string[];
	try {
		srcTables = (
			src.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
				name: string;
			}[]
		).map((r) => r.name);
	} catch {
		src.close();
		throw new Error('Il file non è un database SQLite valido');
	}
	const srcCols = new Map<string, string[]>();
	for (const t of TABLES) {
		if (!srcTables.includes(t)) continue;
		srcCols.set(
			t,
			(src.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name)
		);
	}
	src.close();
	if (!srcCols.has('instruments') || !srcCols.has('transactions'))
		throw new Error('Il file non sembra un backup di Cunti (tabelle mancanti)');

	db.prepare('ATTACH ? AS restore').run(full);
	try {
		db.exec('BEGIN');
		db.exec('PRAGMA defer_foreign_keys = ON');
		for (const t of [...TABLES].reverse()) db.exec(`DELETE FROM main.${t}`);
		for (const t of TABLES) {
			const cols = srcCols.get(t);
			if (!cols) continue;
			const mainCols = (db.pragma(`table_info(${t})`) as { name: string }[]).map((c) => c.name);
			const common = cols.filter((c) => mainCols.includes(c));
			if (common.length === 0) continue;
			const list = common.map((c) => `"${c}"`).join(', ');
			db.exec(`INSERT INTO main.${t} (${list}) SELECT ${list} FROM restore.${t}`);
		}
		db.exec('COMMIT');
	} catch (e) {
		db.exec('ROLLBACK');
		throw e;
	} finally {
		db.exec('DETACH restore');
	}
	db.pragma('wal_checkpoint(TRUNCATE)');
	log('backup', `restore da ${name} completato`);
}

const CHECK_EVERY = 60 * 60 * 1000; // controllo orario
const ONE_DAY = 24 * 60 * 60 * 1000;

/** Backup automatico: almeno una volta al giorno. Controllo orario così i riavvii
 *  del container non saltano mai la finestra. Chiamato una volta da hooks.server.ts. */
export function startBackupScheduler() {
	const last = getSetting('last_backup');
	log('backup', `scheduler avviato (ultimo backup: ${last ?? 'mai'})`);
	const tick = () => {
		const last = getSetting('last_backup');
		if (!last || Date.now() - Date.parse(last) >= ONE_DAY)
			void createBackup().catch((e) => logError('backup', 'backup automatico fallito', e));
	};
	tick();
	setInterval(tick, CHECK_EVERY);
}
