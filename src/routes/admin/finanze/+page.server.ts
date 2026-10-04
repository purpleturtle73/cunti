import { fail } from '@sveltejs/kit';
import { allCards, db } from '$lib/server/db';
import {
	applyMapping,
	deleteProfile,
	detectHeaderRow,
	findProfileFor,
	getProfile,
	guessMapping,
	headerSignature,
	listProfiles,
	mappingFromForm,
	readCsvTable,
	saveProfile,
	type ColumnMapping,
	type CsvTable
} from '$lib/server/csvmap';
import { createDemoFinances, hasExpenses } from '$lib/server/demo';
import { isNativeFormat, parseExpensesCsv } from '$lib/server/expensecsv';
import {
	applyStaging,
	cardUsage,
	discardStaging,
	renameCard,
	stageImport,
	wipeExpenses
} from '$lib/server/expenses';
import { log } from '$lib/server/log';
import { discardStaging as discardStagingFile, readStaging, writeStaging } from '$lib/server/staging';
import { EXPENSE_CSV_MAX_BYTES, LOGO_MAX_BYTES, LOGO_MIMES } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

/** Admin → Finanze: card/conti (con normalizzazione), import CSV, svuotamento.
 *  Categorie e conflitti hanno pagine proprie. */
export const load: PageServerLoad = () => ({
	cards: allCards(),
	cardUsage: cardUsage(),
	hasMovements: hasExpenses(),
	importProfiles: listProfiles().map((p) => ({ name: p.name, columns: p.signature.split('|').length, updated: p.updated_at }))
});

// ---------- Import con mappatura delle colonne ----------

/** File in attesa di mappatura (staging "mappatura"). */
interface MappingStaging {
	text: string;
	fileName: string;
	defaultCard: string;
}

/** Stato del passo di mappatura per la UI: colonne, righe di esempio, proposta. */
function mappingState(
	token: string,
	staged: MappingStaging,
	mapping: ColumnMapping,
	extra: { profileName?: string; notice?: string | null; errors?: string[] } = {}
) {
	const table = readCsvTable(staged.text, mapping.skipRows);
	return {
		token,
		fileName: staged.fileName,
		defaultCard: staged.defaultCard,
		headerLine: table.headerLine,
		headers: table.headers,
		sample: table.rows.slice(0, 6).map((r) => r.fields),
		totalRows: table.rows.length,
		mapping,
		profileName: extra.profileName ?? '',
		notice: extra.notice ?? null,
		errors: extra.errors ?? []
	};
}

/** Mette il file in staging di mappatura e chiede le colonne all'utente. */
function toMapping(staged: MappingStaging, mapping: ColumnMapping, extra: { profileName?: string; notice?: string | null } = {}) {
	const token = writeStaging('mappatura', staged);
	return { section: 'spese-import' as const, mapping: mappingState(token, staged, mapping, extra) };
}

/**
 * Applica una mappatura e passa all'anteprima normale. Con errori si torna al passo di
 * mappatura (riusando lo staging se c'è già), così si correggono le colonne senza
 * ricaricare il file. Con `profileName` la mappatura viene salvata come profilo.
 */
function stageMapped(
	staged: MappingStaging,
	table: CsvTable,
	mapping: ColumnMapping,
	via: string,
	profileName = '',
	token: string | null = null
) {
	const r = applyMapping(table, mapping);
	const errors = r.errors.length > 0 ? r.errors : r.rows.length === 0 ? ['Nessuna riga da importare con questa mappatura.'] : [];
	if (errors.length > 0) {
		const t = token ?? writeStaging('mappatura', staged);
		const shown = errors.length > 25 ? [...errors.slice(0, 25), `… e altri ${errors.length - 25} errori.`] : errors;
		return fail(400, { section: 'spese-import' as const, mapping: mappingState(t, staged, mapping, { profileName, errors: shown }) });
	}
	if (profileName) saveProfile(profileName, table.headers, mapping);
	if (token) discardStagingFile('mappatura', token);
	const preview = stageImport(r.rows, staged.defaultCard);
	const skipped = [
		r.skippedNoDate === 1 ? '1 riga senza data ignorata (totale, saldo…)' : '',
		r.skippedNoDate > 1 ? `${r.skippedNoDate} righe senza data ignorate (totali, saldi…)` : '',
		r.skippedZero > 0 ? `${r.skippedZero} a importo zero` : ''
	].filter(Boolean);
	const mappedNote =
		`Letto con ${via}` +
		(skipped.length > 0 ? `: ${skipped.join(', ')}` : '') +
		'.' +
		(profileName && token ? ` Profilo "${profileName}" salvato: i prossimi file con questa intestazione verranno riconosciuti.` : '');
	log('spese', `CSV "${staged.fileName}" letto con ${via}: ${preview.toInsert} nuove, ${preview.skippedDuplicates} duplicate`);
	return { section: 'spese-import' as const, preview, mappedNote };
}

export const actions: Actions = {
	createDemo: async () => {
		const rep = await createDemoFinances();
		if (!rep)
			return fail(400, {
				section: 'demo',
				error: 'Ci sono già movimenti: i dati demo si creano solo su una sezione vuota (svuotala prima, con backup automatico).'
			});
		return {
			section: 'demo',
			success:
				`Dati demo creati: ${rep.inserted} movimenti (${rep.unknown} senza categoria, ${rep.conflicts} in conflitto con le regole), ` +
				`${rep.categories} categorie di default e ${rep.cards} card demo al posto delle precedenti (backup ${rep.backup}).`
		};
	},

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
		return { section: 'card', success: 'Card eliminata (i movimenti restano intatti).' };
	},


	// ---------- Finanze: import CSV a due fasi ----------

	importExpenses: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		const defaultCard = String(form.get('default_card') || '').trim() || 'conto';
		const format = String(form.get('format') || 'auto');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { section: 'spese-import', importErrors: ['Seleziona un file CSV.'] });
		if (file.size > EXPENSE_CSV_MAX_BYTES)
			return fail(400, { section: 'spese-import', importErrors: ['File troppo grande (max 20 MB).'] });
		const text = await file.text();
		const staged: MappingStaging = { text, fileName: file.name, defaultCard };

		// profilo scelto a mano, oppure riconosciuto dall'intestazione del file
		if (format.startsWith('profile:')) {
			const profile = getProfile(format.slice('profile:'.length));
			if (!profile) return fail(400, { section: 'spese-import', importErrors: ['Profilo inesistente.'] });
			const table = readCsvTable(text, profile.mapping.skipRows);
			if (headerSignature(table.headers) !== profile.signature)
				return toMapping(staged, profile.mapping, {
					profileName: profile.name,
					notice: `L'intestazione del file non è quella del profilo "${profile.name}": controlla la mappatura (salvandola il profilo si aggiorna).`
				});
			return stageMapped(staged, table, profile.mapping, `il profilo "${profile.name}"`, profile.name);
		}
		if (format === 'manual' || !isNativeFormat(text)) {
			const found = format === 'auto' ? findProfileFor(text) : null;
			if (found) return stageMapped(staged, found.table, found.profile.mapping, `il profilo "${found.profile.name}"`, found.profile.name);
			const skip = detectHeaderRow(text);
			return toMapping(staged, guessMapping(readCsvTable(text, skip).headers, skip), {
				notice:
					format === 'manual'
						? null
						: 'Il file non è nel formato di Cunti e nessun profilo salvato lo riconosce: indica tu le colonne (la proposta qui sotto è automatica).'
			});
		}

		const { rows, errors } = parseExpensesCsv(text);
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

	/** Passo di mappatura: aggiorna le colonne (nuova riga d'intestazione), annulla o applica. */
	mapImport: async ({ request }) => {
		const form = await request.formData();
		const token = String(form.get('token') || '');
		const staged = readStaging<MappingStaging>('mappatura', token);
		if (!staged)
			return fail(400, { section: 'spese-import', importErrors: ['Import scaduto o già applicato: ricarica il file.'] });
		const intent = String(form.get('intent') || 'apply');
		const profileName = String(form.get('profile_name') || '').trim().slice(0, 60);
		let mapping = mappingFromForm(form);

		if (intent === 'cancel') {
			discardStagingFile('mappatura', token);
			return { section: 'spese-import', cancelled: true };
		}
		if (intent === 'refresh') {
			// altra riga d'intestazione = altre colonne: nuova proposta
			mapping = guessMapping(readCsvTable(staged.text, mapping.skipRows).headers, mapping.skipRows);
			return { section: 'spese-import', mapping: mappingState(token, staged, mapping, { profileName }) };
		}

		const table = readCsvTable(staged.text, mapping.skipRows);
		const res = stageMapped(staged, table, mapping, 'la mappatura', profileName, token);
		return res;
	},

	deleteImportProfile: async ({ request }) => {
		const name = String((await request.formData()).get('name') || '');
		if (!deleteProfile(name)) return fail(400, { section: 'profili', error: 'Profilo inesistente.' });
		return { section: 'profili', success: `Profilo "${name}" eliminato.` };
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


	// ---------- Finanze: svuota, normalizzazione card ----------

	wipeExpenses: async ({ request }) => {
		const form = await request.formData();
		if (form.get('confirm') !== 'ELIMINA')
			return fail(400, { section: 'spese-dati', error: 'Conferma non valida: scrivi ELIMINA nel campo.' });
		const n = await wipeExpenses();
		return { section: 'spese-dati', success: `Eliminati ${n} movimenti (backup creato prima dello svuotamento).` };
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
			return fail(400, { section: 'card', error: `Nessun movimento con card "${oldName}".` });
		return {
			section: 'card',
			success: `"${oldName}" → "${newName}": ${changed} movimenti aggiornati.`
		};
	},

};
