import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// DB isolato per i test: impostato PRIMA dell'import del modulo db
process.env.DATA_DIR = 'tmp/test-backup';
fs.rmSync('tmp/test-backup', { recursive: true, force: true });

const { db, setSetting, getSetting } = await import('./db');
const { BACKUP_DIR, backupPath, createBackup, deleteBackup, listBackups, restoreBackup } =
	await import('./backup');

function insertInstrument(symbol: string): number {
	return Number(
		db
			.prepare(
				"INSERT INTO instruments (symbol, name, type, ter_pct, tax_rate_pct) VALUES (?, ?, 'etf', 0.2, 26)"
			)
			.run(symbol, symbol).lastInsertRowid
	);
}

describe('backup: creazione, lista, rotazione', () => {
	it('createBackup produce un file valido e aggiorna last_backup', async () => {
		insertInstrument('BK1.MI');
		const info = await createBackup();
		expect(info.size).toBeGreaterThan(0);
		expect(fs.existsSync(path.join(BACKUP_DIR, info.name))).toBe(true);
		expect(getSetting('last_backup')).toBeTruthy();
		expect(listBackups().some((b) => b.name === info.name)).toBe(true);
	});

	it('rotazione: elimina i backup automatici più vecchi di 10 giorni', async () => {
		const oldFile = path.join(BACKUP_DIR, 'cunti-20200101-000000.db');
		fs.copyFileSync(path.join(BACKUP_DIR, listBackups()[0].name), oldFile);
		const old = new Date(Date.now() - 11 * 24 * 60 * 60 * 1000);
		fs.utimesSync(oldFile, old, old);

		await createBackup(); // il nuovo backup fa scattare la rotazione
		expect(fs.existsSync(oldFile)).toBe(false);
	});

	it('backupPath rifiuta nomi con traversal o non validi', () => {
		expect(() => backupPath('../cunti.db')).toThrow();
		expect(() => backupPath('foo/bar.db')).toThrow();
		expect(() => backupPath('inesistente.db')).toThrow();
	});
});

describe('restore', () => {
	it('ripristina i dati al momento del backup', async () => {
		const before = db.prepare('SELECT COUNT(*) AS n FROM instruments').get() as { n: number };
		const info = await createBackup();

		// modifiche successive al backup: uno strumento in più e un setting cambiato
		insertInstrument('BK2.MI');
		setSetting('marker', 'dopo-il-backup');

		restoreBackup(info.name);

		const after = db.prepare('SELECT COUNT(*) AS n FROM instruments').get() as { n: number };
		expect(after.n).toBe(before.n);
		expect(getSetting('marker')).toBeNull();
	});

	it('rifiuta file che non sono database SQLite di Cunti', () => {
		const bogus = path.join(BACKUP_DIR, 'upload-bogus-20260101-000000.db');
		fs.writeFileSync(bogus, 'non sono un database');
		expect(() => restoreBackup('upload-bogus-20260101-000000.db')).toThrow();
		deleteBackup('upload-bogus-20260101-000000.db');
	});
});
