import { fail } from '@sveltejs/kit';
import { allBrokers, allInstruments, db, getSetting, type Instrument } from '$lib/server/db';
import { log, logError } from '$lib/server/log';
import { refreshFx, refreshInstrument } from '$lib/server/prices';
import {
	applyTxStaging,
	discardTxStaging,
	stageTxImport,
	wipeTransactions
} from '$lib/server/transactions';
import { parseTransactionsCsv } from '$lib/server/txcsv';
import { LOGO_MAX_BYTES, LOGO_MIMES, TX_CSV_MAX_BYTES } from '$lib/server/uploads';
import type { Actions, PageServerLoad } from './$types';

/** Amministrazione → Transazioni: strumenti, broker, import/svuotamento transazioni,
 *  esito dell'ultimo aggiornamento prezzi. */
export const load: PageServerLoad = () => {
	const brokers = db
		.prepare(
			`SELECT b.id, b.name, b.logo_mime, (b.logo IS NOT NULL) AS has_logo,
				(SELECT COUNT(*) FROM transactions t WHERE t.broker_id = b.id) AS tx_count
			 FROM brokers b ORDER BY b.name`
		)
		.all() as (ReturnType<typeof allBrokers>[number] & { tx_count: number })[];
	const instruments = db
		.prepare(
			`SELECT i.*,
				(SELECT COUNT(*) FROM transactions t WHERE t.instrument_id = i.id) AS tx_count,
				(SELECT MAX(date) FROM prices p WHERE p.instrument_id = i.id) AS last_price_date
			 FROM instruments i ORDER BY i.name`
		)
		.all() as (Instrument & { tx_count: number; last_price_date: string | null })[];
	const reportRaw = getSetting('last_refresh_report');
	let refreshReport: { symbol: string; ok: boolean; points?: number; error?: string }[] = [];
	try {
		refreshReport = reportRaw ? JSON.parse(reportRaw) : [];
	} catch {
		refreshReport = [];
	}
	return { brokers, instruments, refreshReport, lastRefresh: getSetting('last_refresh') };
};

export const actions: Actions = {
	createInstrument: async ({ request }) => {
		const form = await request.formData();
		const type = String(form.get('type'));
		const symbol = String(form.get('symbol') || '').trim();
		const name = String(form.get('name') || '').trim();
		const isin = String(form.get('isin') || '').trim() || null;
		const ter_pct = Number(String(form.get('ter_pct') || '0').replace(',', '.'));
		const tax_rate_pct = Number(String(form.get('tax_rate_pct') || '26').replace(',', '.'));
		const currency = String(form.get('currency') || 'EUR');

		if (!['etf', 'crypto'].includes(type) || !symbol || !name)
			return fail(400, { section: 'instruments', error: 'Tipo, simbolo e nome sono obbligatori.' });
		if (!['EUR', 'USD'].includes(currency))
			return fail(400, { section: 'instruments', error: 'Valuta non valida.' });
		if (!Number.isFinite(ter_pct) || ter_pct < 0 || ter_pct > 5)
			return fail(400, { section: 'instruments', error: 'TER non valido (0–5%).' });
		if (!Number.isFinite(tax_rate_pct) || tax_rate_pct < 0 || tax_rate_pct > 50)
			return fail(400, { section: 'instruments', error: 'Aliquota non valida.' });

		try {
			const info = db
				.prepare(
					'INSERT INTO instruments (symbol, name, type, isin, ter_pct, tax_rate_pct, currency) VALUES (?, ?, ?, ?, ?, ?, ?)'
				)
				.run(symbol, name, type, isin, ter_pct, tax_rate_pct, currency);

			const inst = db
				.prepare('SELECT * FROM instruments WHERE id = ?')
				.get(info.lastInsertRowid) as Instrument;
			// full history download; report errors on the page instead of failing the insert
			try {
				const points = await refreshInstrument(inst, true);
				if (currency !== 'EUR') await refreshFx(); // serve il cambio per convertire in EUR
				log('instruments', `creato ${symbol} (${type}, ${currency}): ${points} prezzi scaricati`);
			} catch (e) {
				logError('instruments', `creato ${symbol}, download prezzi fallito`, e);
				return {
					section: 'instruments',
					warning: `Strumento creato, ma il download prezzi è fallito: ${String(e)}. Controlla il simbolo e usa "Aggiorna prezzi".`
				};
			}
			return { section: 'instruments', success: `Strumento ${symbol} creato.` };
		} catch (e) {
			if (String(e).includes('UNIQUE'))
				return fail(400, { section: 'instruments', error: 'Simbolo già presente.' });
			throw e;
		}
	},

	deleteInstrument: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { section: 'instruments', error: 'ID mancante.' });
		const inst = db.prepare('SELECT symbol FROM instruments WHERE id = ?').get(id) as
			| { symbol: string }
			| undefined;
		if (!inst) return fail(400, { section: 'instruments', error: 'Strumento inesistente.' });
		// Guardia server: se esistono transazioni la cancellazione (a cascata) va confermata esplicitamente
		const txCount = (
			db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE instrument_id = ?').get(id) as {
				c: number;
			}
		).c;
		if (txCount > 0 && form.get('force') !== '1')
			return fail(400, {
				section: 'instruments',
				error: `"${inst.symbol}" ha ${txCount} transazioni: eliminazione non confermata.`
			});
		db.prepare('DELETE FROM instruments WHERE id = ?').run(id);
		log('instruments', `eliminato ${inst.symbol} (id ${id}) con ${txCount} transazioni`);
		return { section: 'instruments', success: `Strumento ${inst.symbol} eliminato.` };
	},

	updateInstrument: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const ter_pct = Number(String(form.get('ter_pct') || '0').replace(',', '.'));
		const tax_rate_pct = Number(String(form.get('tax_rate_pct') || '26').replace(',', '.'));
		if (!id || !Number.isFinite(ter_pct) || !Number.isFinite(tax_rate_pct))
			return fail(400, { section: 'instruments', error: 'Dati non validi.' });
		db.prepare('UPDATE instruments SET ter_pct = ?, tax_rate_pct = ? WHERE id = ?').run(
			ter_pct,
			tax_rate_pct,
			id
		);
		return { section: 'instruments', success: 'Strumento aggiornato.' };
	},


	// ---------- Broker ----------

	createBroker: async ({ request }) => {
		const form = await request.formData();
		const name = String(form.get('name') || '').trim();
		if (!name) return fail(400, { section: 'broker', error: 'Nome broker obbligatorio.' });

		let logo: Buffer | null = null;
		let logoMime: string | null = null;
		const file = form.get('logo');
		if (file instanceof File && file.size > 0) {
			if (!LOGO_MIMES.includes(file.type))
				return fail(400, { section: 'broker', error: 'Logo: usa PNG, JPEG, SVG o WebP.' });
			if (file.size > LOGO_MAX_BYTES)
				return fail(400, { section: 'broker', error: 'Logo troppo grande (max 512 KB).' });
			logo = Buffer.from(await file.arrayBuffer());
			logoMime = file.type;
		}

		try {
			db.prepare('INSERT INTO brokers (name, logo, logo_mime) VALUES (?, ?, ?)').run(
				name,
				logo,
				logoMime
			);
			return { section: 'broker', success: `Broker "${name}" creato.` };
		} catch (e) {
			if (String(e).includes('UNIQUE'))
				return fail(400, { section: 'broker', error: 'Broker già presente.' });
			throw e;
		}
	},

	updateBrokerLogo: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const file = form.get('logo');
		if (!id || !(file instanceof File) || file.size === 0)
			return fail(400, { section: 'broker', error: 'Seleziona un file per il logo.' });
		if (!LOGO_MIMES.includes(file.type))
			return fail(400, { section: 'broker', error: 'Logo: usa PNG, JPEG, SVG o WebP.' });
		if (file.size > LOGO_MAX_BYTES)
			return fail(400, { section: 'broker', error: 'Logo troppo grande (max 512 KB).' });
		db.prepare('UPDATE brokers SET logo = ?, logo_mime = ? WHERE id = ?').run(
			Buffer.from(await file.arrayBuffer()),
			file.type,
			id
		);
		return { section: 'broker', success: 'Logo aggiornato.' };
	},

	deleteBroker: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id) return fail(400, { section: 'broker', error: 'ID mancante.' });
		// broker_id sulle transazioni va a NULL (ON DELETE SET NULL)
		db.prepare('DELETE FROM brokers WHERE id = ?').run(id);
		return { section: 'broker', success: 'Broker eliminato.' };
	},


	// ---------- Transazioni: import CSV a due fasi, svuotamento ----------

	importTransactions: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { section: 'tx-import', importErrors: ['Seleziona un file CSV.'] });
		if (file.size > TX_CSV_MAX_BYTES)
			return fail(400, { section: 'tx-import', importErrors: ['File troppo grande (max 2 MB).'] });

		const { rows, errors } = parseTransactionsCsv(
			await file.text(),
			allInstruments(),
			allBrokers()
		);
		if (errors.length > 0) {
			log('transazioni', `CSV "${file.name}" rifiutato: ${errors.length} errori`);
			return fail(400, { section: 'tx-import', importErrors: errors });
		}
		if (rows.length === 0)
			return fail(400, { section: 'tx-import', importErrors: ['Nessuna riga da importare.'] });

		// Nomi distinti da quelli dell'import spese (txPreview/txApplied): le action
		// condividono il tipo ActionData, e due `preview` di forma diversa non si
		// riuscirebbero a distinguere nel template.
		const txPreview = stageTxImport(rows);
		log(
			'transazioni',
			`CSV "${file.name}" in staging: ${txPreview.toInsert} nuove, ${txPreview.skippedDuplicates} duplicate`
		);
		return { section: 'tx-import', txPreview };
	},

	applyTransactionImport: async ({ request }) => {
		const form = await request.formData();
		const res = applyTxStaging(String(form.get('token') || ''));
		if (!res)
			return fail(400, {
				section: 'tx-import',
				importErrors: ['Import scaduto o già applicato: ricarica il file.']
			});
		return { section: 'tx-import', txApplied: res };
	},

	cancelTransactionImport: async ({ request }) => {
		const form = await request.formData();
		discardTxStaging(String(form.get('token') || ''));
		return { section: 'tx-import', txCancelled: true };
	},

	wipeTransactions: async ({ request }) => {
		const form = await request.formData();
		if (form.get('confirm') !== 'ELIMINA')
			return fail(400, {
				section: 'tx-dati',
				error: 'Conferma non valida: scrivi ELIMINA nel campo.'
			});
		try {
			const n = await wipeTransactions();
			return {
				section: 'tx-dati',
				success: `Eliminate ${n} transazioni (backup creato prima dello svuotamento).`
			};
		} catch (e) {
			logError('transazioni', 'svuotamento transazioni fallito', e);
			return fail(500, { section: 'tx-dati', error: `Svuotamento fallito: ${String(e)}` });
		}
	},

};
