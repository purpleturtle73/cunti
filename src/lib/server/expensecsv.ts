/**
 * Parser CSV per import spese (export bancario, eventualmente pre-elaborato).
 *
 * Formato: prima riga di intestazione, separatore `;` o `,` (autodetect).
 * Colonne obbligatorie (case-insensitive): data_ops (o data), descrizione, importo.
 * Opzionali: card, moneyin, moneyout, categoria. Colonne extra (es. data_valuta) ignorate.
 * - data: DD/MM/YYYY oppure YYYY-MM-DD
 * - importo: firmato (negativo = uscita), virgola o punto decimale
 * - moneyin/moneyout: se presenti vengono solo validati (importo = moneyin − moneyout)
 * - categoria: stringa libera; vuota o "unknown" → verrà categorizzata dalle regole
 */
import { normHeader, parseDate, parseNumber, splitLine } from './txcsv';

export interface ParsedExpense {
	line: number; // riga nel file (1-based, header = 1)
	date: string; // YYYY-MM-DD
	description: string;
	card: string | null; // null → card di default scelta nel form
	amount: number;
	category: string | null; // null → da categorizzare
}

export interface ExpenseCsvResult {
	rows: ParsedExpense[];
	errors: string[];
}

const COLS = ['data_ops', 'data', 'descrizione', 'card', 'importo', 'moneyin', 'moneyout', 'categoria'] as const;

/** Il file ha l'intestazione nel formato di Cunti? Altrimenti serve la mappatura delle colonne. */
export function isNativeFormat(text: string): boolean {
	const first = text.replace(/^﻿/, '').split(/\r\n|\r|\n/).find((l) => l.trim() !== '') ?? '';
	const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
	const header = splitLine(first, sep).map(normHeader);
	return (header.includes('data_ops') || header.includes('data')) && header.includes('descrizione') && header.includes('importo');
}

export function parseExpensesCsv(text: string): ExpenseCsvResult {
	const errors: string[] = [];
	const rows: ParsedExpense[] = [];

	const lines = text
		.replace(/^\ufeff/, '')
		.split(/\r\n|\r|\n/)
		.filter((l) => l.trim() !== '');
	if (lines.length < 2) return { rows, errors: ['File vuoto o senza righe dati.'] };

	const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
	const header = splitLine(lines[0], sep).map(normHeader);

	const col: Record<string, number> = {};
	for (const name of COLS) {
		const idx = header.indexOf(name);
		if (idx >= 0) col[name] = idx;
	}
	const dateCol = col.data_ops ?? col.data;
	if (dateCol === undefined || col.descrizione === undefined || col.importo === undefined)
		return {
			rows,
			errors: [
				'Intestazione: servono le colonne data_ops (o data), descrizione, importo. Opzionali: card, moneyin, moneyout, categoria.'
			]
		};

	const today = new Date().toISOString().slice(0, 10);

	for (let n = 1; n < lines.length; n++) {
		const fields = splitLine(lines[n], sep);
		const get = (name: string) => (name in col ? (fields[col[name]] ?? '').trim() : '');
		const lineNo = n + 1;

		const date = parseDate(fields[dateCol] ?? '');
		if (!date) {
			errors.push(`Riga ${lineNo}: data non valida "${fields[dateCol] ?? ''}" (usa DD/MM/YYYY o YYYY-MM-DD).`);
			continue;
		}
		if (date > today) {
			errors.push(`Riga ${lineNo}: data nel futuro (${date}).`);
			continue;
		}

		const description = get('descrizione');
		if (!description) {
			errors.push(`Riga ${lineNo}: descrizione vuota.`);
			continue;
		}

		const amount = parseNumber(get('importo'));
		if (!Number.isFinite(amount)) {
			errors.push(`Riga ${lineNo}: importo non valido "${get('importo')}".`);
			continue;
		}

		// moneyin/moneyout: colonne derivate — se presenti devono essere coerenti con importo
		const inRaw = get('moneyin');
		const outRaw = get('moneyout');
		if (inRaw !== '' || outRaw !== '') {
			const moneyin = inRaw === '' ? 0 : parseNumber(inRaw);
			const moneyout = outRaw === '' ? 0 : parseNumber(outRaw);
			if (!Number.isFinite(moneyin) || !Number.isFinite(moneyout)) {
				errors.push(`Riga ${lineNo}: moneyin/moneyout non validi.`);
				continue;
			}
			if (Math.abs(amount - (moneyin - moneyout)) > 0.005) {
				errors.push(
					`Riga ${lineNo}: incoerenza importo=${amount} vs moneyin−moneyout=${(moneyin - moneyout).toFixed(2)}.`
				);
				continue;
			}
		}

		const categoryRaw = get('categoria');
		const category = categoryRaw === '' || categoryRaw.toLowerCase() === 'unknown' ? null : categoryRaw;

		rows.push({
			line: lineNo,
			date,
			description,
			card: get('card') || null,
			amount,
			category
		});
	}

	return { rows, errors };
}
