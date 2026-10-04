import { fail } from '@sveltejs/kit';
import {
	createBackup,
	deleteBackup,
	listBackups,
	restoreBackup,
	saveUploadedBackup
} from '$lib/server/backup';
import { getSetting } from '$lib/server/db';
import { logError } from '$lib/server/log';
import { UPLOAD_MAX_BYTES } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

/** Amministrazione → Generale: ciò che riguarda tutta l'app (backup e ripristino). */
export const load: PageServerLoad = () => ({
	backups: listBackups(),
	lastBackup: getSetting('last_backup')
});

export const actions: Actions = {
	backupNow: async () => {
		try {
			const info = await createBackup();
			return { section: 'backup', success: `Backup creato: ${info.name}` };
		} catch (e) {
			logError('backup', 'backup manuale fallito', e);
			return fail(500, { section: 'backup', error: `Backup fallito: ${String(e)}` });
		}
	},

	restore: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') || '');
		try {
			// backup di sicurezza dello stato attuale prima di sovrascrivere
			await createBackup();
			restoreBackup(name);
			return { section: 'backup', success: `Ripristinato ${name}. Ricarica le pagine aperte.` };
		} catch (e) {
			logError('backup', `restore da ${name} fallito`, e);
			return fail(400, { section: 'backup', error: `Ripristino fallito: ${String(e)}` });
		}
	},

	deleteBackup: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') || '');
		try {
			deleteBackup(name);
			return { section: 'backup', success: `Eliminato ${name}.` };
		} catch (e) {
			logError('backup', `eliminazione ${name} fallita`, e);
			return fail(400, { section: 'backup', error: String(e) });
		}
	},

	uploadBackup: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { section: 'backup', error: 'Nessun file selezionato.' });
		if (!file.name.toLowerCase().endsWith('.db'))
			return fail(400, { section: 'backup', error: 'Il file deve essere un .db.' });
		if (file.size > UPLOAD_MAX_BYTES)
			return fail(400, { section: 'backup', error: 'File troppo grande.' });
		const name = saveUploadedBackup(file.name, Buffer.from(await file.arrayBuffer()));
		return {
			section: 'backup',
			success: `Caricato come ${name}: ora puoi ripristinarlo dalla lista.`
		};
	},

};
