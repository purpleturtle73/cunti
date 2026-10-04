import { fail } from '@sveltejs/kit';
import {
	createBackup,
	deleteBackup,
	listBackups,
	restoreBackup,
	saveUploadedBackup
} from '$lib/server/backup';
import {
	loadMeta,
	loadRules,
	matchCategory,
	renameCategoryInRules,
	saveMeta
} from '$lib/server/categorize';
import {
	allBrokers,
	allCards,
	allInstruments,
	db,
	getSetting,
	type Instrument
} from '$lib/server/db';
import { parseExpensesCsv } from '$lib/server/expensecsv';
import {
	applyStaging,
	categorySummaries,
	discardStaging,
	stageImport,
	wipeExpenses
} from '$lib/server/expenses';
import { log, logError } from '$lib/server/log';
import { refreshFx, refreshInstrument } from '$lib/server/prices';
import { APP_VERSION } from '$lib/server/version';
import {
	applyTxStaging,
	discardTxStaging,
	stageTxImport,
	wipeTransactions
} from '$lib/server/transactions';
import { parseTransactionsCsv } from '$lib/server/txcsv';
import type { Actions, PageServerLoad } from './$types';

const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
const LOGO_MAX_BYTES = 512 * 1024;
const UPLOAD_MAX_BYTES = 200 * 1024 * 1024;
const TX_CSV_MAX_BYTES = 2 * 1024 * 1024;

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
	const rules = loadRules();
	return {
		version: APP_VERSION,
		backups: listBackups(),
		brokers,
		instruments,
		cards: allCards(),
		expenseSummaries: categorySummaries(),
		expenseMeta: loadMeta(),
		rulesInfo: {
			error: rules.error,
			warnings: rules.warnings,
			categories: rules.categories.length,
			keywords: rules.rules.length
		},
		lastBackup: getSetting('last_backup'),
		lastRefresh: getSetting('last_refresh'),
		refreshReport
	};
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

	// ---------- Spese: import CSV a due fasi ----------

	importExpenses: async ({ request }) => {
		const form = await request.formData();
		const file = form.get('file');
		const defaultCard = String(form.get('default_card') || '').trim() || 'conto';
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { section: 'spese-import', importErrors: ['Seleziona un file CSV.'] });
		if (file.size > 20 * 1024 * 1024)
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

	// ---------- Spese: categorie, regole, svuota ----------

	wipeExpenses: async ({ request }) => {
		const form = await request.formData();
		if (form.get('confirm') !== 'ELIMINA')
			return fail(400, { section: 'spese-dati', error: 'Conferma non valida: scrivi ELIMINA nel campo.' });
		const n = await wipeExpenses();
		return { section: 'spese-dati', success: `Eliminate ${n} spese (backup creato prima dello svuotamento).` };
	},

	setExpenseMeta: async ({ request }) => {
		const form = await request.formData();
		const category = String(form.get('category') || '');
		if (!category) return fail(400, { section: 'spese-categorie', error: 'Categoria mancante.' });
		const meta = loadMeta();
		const icon = String(form.get('icon') || '');
		const color = meta[category]?.color; // il colore si gestisce dal file
		const entry: (typeof meta)[string] = {};
		if (icon) entry.icon = icon;
		if (color) entry.color = color;
		if (form.get('transfer') === '1') entry.transfer = true;
		if (Object.keys(entry).length === 0) delete meta[category];
		else meta[category] = entry;
		saveMeta(meta);
		return { section: 'spese-categorie', success: true };
	},

	renameExpenseCategory: async ({ request }) => {
		const form = await request.formData();
		const oldName = String(form.get('old') || '').trim();
		const newName = String(form.get('new') || '').trim();
		if (!oldName || !newName || oldName === newName)
			return fail(400, { section: 'spese-categorie', error: 'Nomi non validi.' });
		const changed = db.prepare('UPDATE expenses SET category = ? WHERE category = ?').run(newName, oldName).changes;
		const inRules = renameCategoryInRules(oldName, newName);
		const meta = loadMeta();
		if (meta[oldName]) {
			meta[newName] = { ...meta[oldName], ...meta[newName] };
			delete meta[oldName];
			saveMeta(meta);
		}
		log('spese', `categoria rinominata ${oldName} → ${newName} (${changed} voci, regole: ${inRules ? 'sì' : 'no'})`);
		return {
			section: 'spese-categorie',
			renamed: `"${oldName}" → "${newName}": ${changed} voci aggiornate${inRules ? ', regole aggiornate' : ', nessuna regola da aggiornare'}.`
		};
	},

	testDescription: async ({ request }) => {
		const form = await request.formData();
		const description = String(form.get('description') || '');
		const rules = loadRules();
		const m = matchCategory(description, rules.rules);
		return {
			section: 'spese-regole',
			test: { description, category: m?.category ?? 'unknown', keyword: m?.keyword ?? null }
		};
	},

	keywordReport: async () => {
		const rules = loadRules();
		if (rules.error) return fail(400, { section: 'spese-regole', error: rules.error });
		const stmt = db.prepare(
			'SELECT COUNT(*) AS c, MAX(date) AS last FROM expenses WHERE instr(lower(description), lower(?)) > 0'
		);
		const report = rules.rules.map((r) => {
			const row = stmt.get(r.keyword) as { c: number; last: string | null };
			return { keyword: r.keyword, category: r.category, matches: row.c, last: row.last };
		});
		report.sort((a, b) => a.matches - b.matches || a.category.localeCompare(b.category));
		return { section: 'spese-regole', report };
	},

	applyRules: async ({ request }) => {
		const form = await request.formData();
		const confirm = form.get('confirm') === '1';
		const rules = loadRules();
		if (rules.error) return fail(400, { section: 'spese-regole', error: rules.error });
		const unknowns = db
			.prepare("SELECT id, description FROM expenses WHERE category = 'unknown'")
			.all() as { id: number; description: string }[];
		const matches: { id: number; category: string }[] = [];
		const byCategory = new Map<string, number>();
		for (const u of unknowns) {
			const m = matchCategory(u.description, rules.rules);
			if (m) {
				matches.push({ id: u.id, category: m.category });
				byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
			}
		}
		if (!confirm)
			return {
				section: 'spese-regole',
				rulesPreview: {
					unknown: unknowns.length,
					matched: matches.length,
					byCategory: [...byCategory.entries()]
						.map(([category, count]) => ({ category, count }))
						.sort((a, b) => b.count - a.count)
				}
			};
		const upd = db.prepare('UPDATE expenses SET category = ? WHERE id = ?');
		db.transaction(() => {
			for (const m of matches) upd.run(m.category, m.id);
		})();
		log('spese', `regole retro-applicate: ${matches.length} voci unknown categorizzate`);
		return { section: 'spese-regole', rulesApplied: matches.length };
	}
};
