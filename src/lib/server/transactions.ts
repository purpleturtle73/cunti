/**
 * Transazioni investimenti: import CSV a due fasi (staging + anteprima + conferma),
 * export CSV round-trip, svuotamento con backup automatico.
 *
 * Dedup binario (diverso dalle spese, che hanno dedup a conteggio): la chiave è
 * strumento + tipo + data + quantità + prezzo + commissioni — vedi
 * `insertTransactionsDedup` in db.ts. Note e broker sono esclusi di proposito: la
 * stessa operazione annotata diversamente resta un doppione. Non esiste quindi il
 * concetto di "conflitto" che le spese hanno sulla categoria: una riga o è nuova, o
 * è già presente e si salta.
 */
import { createBackup } from './backup';
import { db, insertTransactionsDedup, type NewTransaction } from './db';
import { log } from './log';
import { discardStaging, readStaging, writeStaging } from './staging';
import type { ParsedTx } from './txcsv';

/** Quante righe si mostrano nella tabella di anteprima (lo staging ne tiene tutte). */
export const PREVIEW_ROWS = 50;

/** Riga in attesa di conferma, arricchita con i dati risolti per renderla leggibile. */
export interface TxPreviewRow {
	line: number;
	symbol: string;
	date: string;
	type: 'buy' | 'sell';
	quantity: number;
	price: number;
	fee: number;
	currency: string;
	broker: string | null;
	notes: string | null;
}

export interface TxImportPreview {
	token: string;
	total: number; // righe valide nel file
	toInsert: number;
	skippedDuplicates: number;
	skippedLines: number[]; // righe del file già presenti nel DB (o doppie nel file)
	rows: TxPreviewRow[]; // prime PREVIEW_ROWS da inserire
	truncated: number; // righe da inserire non mostrate
}

interface StagingFile {
	createdAt: string;
	rows: ParsedTx[];
}

const keyOf = (r: NewTransaction) =>
	`${r.instrument_id}|${r.type}|${r.date}|${r.quantity}|${r.price}|${r.fee}`;

/** Costruisce l'anteprima e salva lo staging su file. Nessuna scrittura sul DB.
 *  Il dedup è calcolato in sola lettura, con la stessa chiave dell'inserimento, e
 *  tiene conto anche dei doppioni interni al file. */
export function stageTxImport(rows: ParsedTx[]): TxImportPreview {
	const existing = new Set(
		(
			db
				.prepare('SELECT instrument_id, type, date, quantity, price, fee FROM transactions')
				.all() as NewTransaction[]
		).map(keyOf)
	);

	const toInsert: ParsedTx[] = [];
	const skippedLines: number[] = [];
	const seen = new Set<string>();

	for (const r of rows) {
		const k = keyOf(r);
		if (existing.has(k) || seen.has(k)) {
			skippedLines.push(r.line);
		} else {
			seen.add(k);
			toInsert.push(r);
		}
	}

	// Nomi risolti solo per le righe mostrate: l'anteprima deve essere leggibile.
	const symbols = new Map(
		(db.prepare('SELECT id, symbol, currency FROM instruments').all() as
			{ id: number; symbol: string; currency: string }[]).map((i) => [i.id, i])
	);
	const brokers = new Map(
		(db.prepare('SELECT id, name FROM brokers').all() as { id: number; name: string }[]).map((b) => [
			b.id,
			b.name
		])
	);

	const preview: TxPreviewRow[] = toInsert.slice(0, PREVIEW_ROWS).map((r) => ({
		line: r.line,
		symbol: symbols.get(r.instrument_id)?.symbol ?? '?',
		currency: symbols.get(r.instrument_id)?.currency ?? 'EUR',
		date: r.date,
		type: r.type,
		quantity: r.quantity,
		price: r.price,
		fee: r.fee,
		broker: r.broker_id != null ? (brokers.get(r.broker_id) ?? null) : null,
		notes: r.notes
	}));

	const token = writeStaging('transazioni', {
		createdAt: new Date().toISOString(),
		rows: toInsert
	} satisfies StagingFile);

	return {
		token,
		total: rows.length,
		toInsert: toInsert.length,
		skippedDuplicates: skippedLines.length,
		skippedLines,
		rows: preview,
		truncated: Math.max(0, toInsert.length - preview.length)
	};
}

/** Applica lo staging. `null` se il token è scaduto o già consumato.
 *  Reinserisce passando da `insertTransactionsDedup`: se il DB è cambiato tra
 *  anteprima e conferma non si creano doppioni. */
export function applyTxStaging(token: string): { inserted: number; skipped: number } | null {
	const staging = readStaging<StagingFile>('transazioni', token);
	if (!staging) return null;

	const { inserted, duplicates } = insertTransactionsDedup(staging.rows);
	discardStaging('transazioni', token);
	log(
		'transazioni',
		`import applicato: ${inserted.length} inserite, ${duplicates.length} saltate come duplicate`
	);
	return { inserted: inserted.length, skipped: duplicates.length };
}

export function discardTxStaging(token: string) {
	discardStaging('transazioni', token);
}

/** Svuota le transazioni; prima crea un backup automatico del DB.
 *  Tocca solo `transactions`: strumenti, storico prezzi, cambi e broker restano,
 *  pronti per un reimport (al contrario di "elimina strumento", che cascata). */
export async function wipeTransactions(): Promise<number> {
	await createBackup();
	const info = db.prepare('DELETE FROM transactions').run();
	log('transazioni', `svuotate ${info.changes} transazioni (backup creato prima del wipe)`);
	return info.changes;
}

/** Export CSV nello stesso formato dell'import (round-trip). */
export function exportTransactionsCsv(): string {
	const rows = db
		.prepare(
			`SELECT t.date, i.symbol, i.isin, t.type, t.quantity, t.price, t.fee, b.name AS broker, t.notes
			 FROM transactions t
			 JOIN instruments i ON i.id = t.instrument_id
			 LEFT JOIN brokers b ON b.id = t.broker_id
			 ORDER BY t.date, t.id`
		)
		.all() as {
		date: string;
		symbol: string;
		isin: string | null;
		type: string;
		quantity: number;
		price: number;
		fee: number;
		broker: string | null;
		notes: string | null;
	}[];

	const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
	const lines = ['data;strumento;isin;tipo;quantita;prezzo;commissioni;broker;note'];
	for (const r of rows) {
		lines.push(
			[
				r.date,
				esc(r.symbol),
				esc(r.isin ?? ''),
				r.type,
				String(r.quantity),
				String(r.price),
				String(r.fee),
				esc(r.broker ?? ''),
				esc(r.notes ?? '')
			].join(';')
		);
	}
	return lines.join('\n') + '\n';
}
