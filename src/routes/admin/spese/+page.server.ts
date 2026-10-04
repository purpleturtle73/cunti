import { fail } from '@sveltejs/kit';
import { allCards, db } from '$lib/server/db';
import { parseExpensesCsv } from '$lib/server/expensecsv';
import {
	applyStaging,
	cardUsage,
	discardStaging,
	renameCard,
	stageImport,
	wipeExpenses
} from '$lib/server/expenses';
import { log } from '$lib/server/log';
import { EXPENSE_CSV_MAX_BYTES, LOGO_MAX_BYTES, LOGO_MIMES } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

/** Amministrazione → Spese: card/conti (con normalizzazione), import CSV, svuotamento.
 *  Categorie e conflitti hanno pagine proprie. */
export const load: PageServerLoad = () => ({
	cards: allCards(),
	cardUsage: cardUsage()
});

export const actions: Actions = {
	// ---------- Card (conti/carte delle spese, config statica con logo) ----------

	createCard: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') || '').trim();
		if (!name) return fail(400, { section: 'card', error: 'Nome card obbligatorio.' });
		let logo: Buffer | null = null;
		let logoMime: string | null = null;
		const file = form.get('logo');
		if (file instanceof File && file.size > 0) {
			if (!LOGO_MIMES.includes(file.type))
				return fail(400, { section: 'card', error: 'Logo: usa PNG, JPEG, SVG o WebP.' });
			if (file.size > LOGO_MAX_BYTES)
				return fail(400, { section: 'card', error: 'Logo troppo grande (max 512 KB).' });
			logo = Buffer.from(await file.arrayBuffer());
			logoMime = file.type;
		}
		try {
			db.prepare('INSERT INTO cards (name, logo, logo_mime) VALUES (?, ?, ?)').run(name, logo, logoMime);
			return { section: 'card', success: `Card "${name}" creata.` };
		} catch (e) {
			if (String(e).includes('UNIQUE')) return fail(400, { section: 'card', error: 'Card già presente.' });
			throw e;
		}
	},

	updateCardLogo: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const file = form.get('logo');
		if (!id || !(file instanceof File) || file.size === 0)
			return fail(400, { section: 'card', error: 'Seleziona un file per il logo.' });
		if (!LOGO_MIMES.includes(file.type))
			return fail(400, { section: 'card', error: 'Logo: usa PNG, JPEG, SVG o WebP.' });
		if (file.size > LOGO_MAX_BYTES)
			return fail(400, { section: 'card', error: 'Logo troppo grande (max 512 KB).' });
		db.prepare('UPDATE cards SET logo = ?, logo_mime = ? WHERE id = ?').run(
			Buffer.from(await file.arrayBuffer()),
			file.type,
			id
		);
		return { section: 'card', success: 'Logo aggiornato.' };
	},

	deleteCard: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { section: 'card', error: 'ID mancante.' });
		// le spese referenziano la card per nome: restano intatte, perdono solo il logo
		db.prepare('DELETE FROM cards WHERE id = ?').run(id);
		return { section: 'card', success: 'Card eliminata (le spese restano intatte).' };
	},


	// ---------- Spese: import CSV a due fasi ----------

	importExpenses: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		const defaultCard = String(form.get('default_card') || '').trim() || 'conto';
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { section: 'spese-import', importErrors: ['Seleziona un file CSV.'] });
		if (file.size > EXPENSE_CSV_MAX_BYTES)
			return fail(400, { section: 'spese-import', importErrors: ['File troppo grande (max 20 MB).'] });

		const { rows, errors } = parseExpensesCsv(await file.text());
		if (errors.length > 0) {
			log('spese', `CSV "${file.name}" rifiutato: ${errors.length} errori`);
			return fail(400, { section: 'spese-import', importErrors: errors });
		}
		if (rows.length === 0)
			return fail(400, { section: 'spese-import', importErrors: ['Nessuna riga da importare.'] });

		const preview = stageImport(rows, defaultCard);
		log(
			'spese',
			`CSV "${file.name}" in staging: ${preview.toInsert} nuove, ${preview.skippedDuplicates} duplicate, ${preview.conflicts.length} conflitti`
		);
		return { section: 'spese-import', preview };
	},

	applyExpenseImport: async ({ request }) => {
		const form = await request.formData();
		const token = String(form.get('token') || '');
		const useCsv = new Set<string>();
		for (const [name, value] of form.entries()) {
			if (name.startsWith('conflict-') && value === 'csv') {
				const key = form.get(`key-${name.slice('conflict-'.length)}`);
				if (typeof key === 'string') useCsv.add(key);
			}
		}
		const res = applyStaging(token, useCsv);
		if (!res)
			return fail(400, {
				section: 'spese-import',
				importErrors: ['Import scaduto o già applicato: ricarica il file.']
			});
		return { section: 'spese-import', applied: res };
	},

	cancelExpenseImport: async ({ request }) => {
		const form = await request.formData();
		discardStaging(String(form.get('token') || ''));
		return { section: 'spese-import', cancelled: true };
	},


	// ---------- Spese: svuota, normalizzazione card ----------

	wipeExpenses: async ({ request }) => {
		const form = await request.formData();
		if (form.get('confirm') !== 'ELIMINA')
			return fail(400, { section: 'spese-dati', error: 'Conferma non valida: scrivi ELIMINA nel campo.' });
		const n = await wipeExpenses();
		return { section: 'spese-dati', success: `Eliminate ${n} spese (backup creato prima dello svuotamento).` };
	},

	// Normalizzazione del campo `card`: gli export bancari producono varianti di
	// battitura dello stesso conto (BancomatAlfa / bancomatAlfa / BancomatA.) che
	// spezzano filtri e statistiche. Rinominare verso un valore esistente le unisce.
	renameExpenseCard: async ({ request }) => {
		const form = await request.formData();
		const oldName = String(form.get('old') || '').trim();
		const newName = String(form.get('new') || '').trim();
		if (!oldName || !newName || oldName === newName)
			return fail(400, { section: 'card', error: 'Nomi non validi.' });
		const changed = renameCard(oldName, newName);
		if (changed === 0)
			return fail(400, { section: 'card', error: `Nessuna spesa con card "${oldName}".` });
		return {
			section: 'card',
			success: `"${oldName}" → "${newName}": ${changed} spese aggiornate.`
		};
	},

};
