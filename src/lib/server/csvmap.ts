/**
 * Import CSV con mappatura delle colonne, per gli export bancari che non hanno il
 * formato di Cunti (data_ops;descrizione;importo…). L'utente indica quale colonna è la
 * data, quale la descrizione, l'importo (unico con segno, oppure entrate/uscite
 * separate), la card e la categoria; la mappatura si salva come **profilo** e un file
 * con la stessa intestazione viene poi riconosciuto da solo.
 *
 * Le colonne si riferiscono per nome d'intestazione, non per posizione: una banca che
 * aggiunge una colonna in fondo non rompe il profilo.
 */
import { db } from './db';
import type { ParsedExpense } from './expensecsv';
import { normHeader, parseDate, parseNumber, splitLine } from './txcsv';

export interface CsvTable {
	sep: string;
	headerLine: number; // riga (1-based) dell'intestazione nel file
	headers: string[];
	rows: { line: number; fields: string[] }[];
}

export interface ColumnMapping {
	skipRows: number; // righe del file prima dell'intestazione
	date: string;
	dateFormat: 'auto' | 'dmy' | 'ymd' | 'mdy';
	description: string;
	description2: string; // '' = nessuna; altrimenti accodata alla prima (es. causale + descrizione)
	amountMode: 'signed' | 'split';
	amount: string; // modalità signed
	invert: boolean; // signed: il file ha le uscite positive
	moneyIn: string; // modalità split
	moneyOut: string;
	decimal: 'auto' | 'comma' | 'dot';
	card: string; // '' = card di default del form
	category: string; // '' = ci pensano le regole
	skipInvalidDates: boolean; // ignora righe senza data valida (totali, saldi, intestazioni ripetute)
}

export const EMPTY_MAPPING: ColumnMapping = {
	skipRows: 0,
	date: '',
	dateFormat: 'auto',
	description: '',
	description2: '',
	amountMode: 'signed',
	amount: '',
	invert: false,
	moneyIn: '',
	moneyOut: '',
	decimal: 'auto',
	card: '',
	category: '',
	skipInvalidDates: true
};

const SEPARATORS = [';', ',', '\t', '|'];
const physicalLines = (text: string) => text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
const bestSep = (line: string) =>
	SEPARATORS.reduce((best, s) => (line.split(s).length > line.split(best).length ? s : best), SEPARATORS[0]);

/** Legge il file: intestazione alla prima riga non vuota dopo `skipRows` righe. */
export function readCsvTable(text: string, skipRows = 0): CsvTable {
	const lines = physicalLines(text);
	let h = Math.max(0, skipRows);
	while (h < lines.length && lines[h].trim() === '') h++;
	const headerRaw = lines[h] ?? '';
	const sep = bestSep(headerRaw);
	const headers = splitLine(headerRaw, sep).map((x) => x.trim());
	const rows: CsvTable['rows'] = [];
	for (let i = h + 1; i < lines.length; i++) {
		if (lines[i].trim() === '') continue;
		rows.push({ line: i + 1, fields: splitLine(lines[i], sep) });
	}
	return { sep, headerLine: h + 1, headers, rows };
}

/**
 * Riga dell'intestazione per i file con righe introduttive (titolo, intestatario,
 * periodo…): la prima con almeno 3 campi seguita da una riga con lo stesso numero di
 * campi. Ritorna quante righe saltare.
 */
export function detectHeaderRow(text: string): number {
	const lines = physicalLines(text);
	const limit = Math.min(lines.length, 40);
	for (let i = 0; i < limit; i++) {
		if (lines[i].trim() === '') continue;
		const sep = bestSep(lines[i]);
		const n = splitLine(lines[i], sep).length;
		if (n < 3) continue;
		let j = i + 1;
		while (j < lines.length && lines[j].trim() === '') j++;
		if (j < lines.length && splitLine(lines[j], sep).length === n) return i;
	}
	return 0;
}

/** Proposta di mappatura dai nomi delle colonne (banche italiane e inglesi). */
export function guessMapping(headers: string[], skipRows = 0): ColumnMapping {
	const norm = headers.map(normHeader);
	const used = new Set<string>();
	const find = (...patterns: RegExp[]) => {
		for (const re of patterns) {
			const i = norm.findIndex((h, k) => re.test(h) && !used.has(headers[k]));
			if (i >= 0) {
				used.add(headers[i]);
				return headers[i];
			}
		}
		return '';
	};
	// la data "valuta" è quella di regolamento: meglio la data dell'operazione
	const date = find(/^data[ _.]?op/, /^data[ _.]?contab/, /^data$/, /^data(?!.*valut)/, /^(booking |transaction )?date$/, /date/, /^data/);
	const description = find(/^descrizione( operazione)?$/, /^descrizione/, /description/, /^dettagli/, /causale/, /^operazione$/, /beneficiario/);
	const description2 = description && !/causale/.test(normHeader(description)) ? find(/causale/) : '';
	const amount = find(/^importo/, /^amount/, /^ammontare/, /^valore/);
	const moneyIn = find(/^entrat/, /^avere/, /accredit/, /^credit/, /^in$/);
	const moneyOut = find(/^uscit/, /^dare/, /addebit/, /^debit/, /^out$/);
	const card = find(/^card$/, /^carta/, /^conto/, /rapporto/, /^account/);
	const category = find(/^categoria/, /^category/);
	return {
		...EMPTY_MAPPING,
		skipRows,
		date,
		description,
		description2,
		amountMode: amount || !(moneyIn || moneyOut) ? 'signed' : 'split',
		amount,
		moneyIn,
		moneyOut,
		card,
		category
	};
}

/** Data nel formato scelto; l'orario eventualmente presente viene ignorato. */
export function parseDateAs(raw: string, format: ColumnMapping['dateFormat']): string | null {
	const s = raw.trim().split(/[\sT]/)[0];
	if (/^\d{8}$/.test(s) && (format === 'auto' || format === 'ymd'))
		return parseDate(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
	const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
	const xy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
	const iso = (y: string, m: string, d: string) =>
		parseDate(`${y.length === 2 ? `20${y}` : y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
	if (ymd && (format === 'auto' || format === 'ymd')) return iso(ymd[1], ymd[2], ymd[3]);
	if (xy && (format === 'auto' || format === 'dmy')) return iso(xy[3], xy[2], xy[1]);
	if (xy && format === 'mdy') return iso(xy[3], xy[1], xy[2]);
	return null;
}

/** Importo con il separatore decimale scelto; tollera valuta, segno in coda e parentesi. */
export function parseAmountAs(raw: string, decimal: ColumnMapping['decimal']): number {
	let s = raw.trim().replace(/[\s ']/g, '').replace(/€|eur|usd|\$|£/gi, '');
	if (s === '') return NaN;
	let negative = false;
	if (/^\(.*\)$/.test(s)) {
		negative = true;
		s = s.slice(1, -1);
	}
	if (s.endsWith('-')) {
		negative = true;
		s = s.slice(0, -1);
	}
	if (s.startsWith('+')) s = s.slice(1);
	let n: number;
	if (decimal === 'comma') n = Number(s.replace(/\./g, '').replace(',', '.'));
	else if (decimal === 'dot') n = Number(s.replace(/,/g, ''));
	else n = parseNumber(s);
	return negative ? -Math.abs(n) : n;
}

export interface MappedResult {
	rows: ParsedExpense[];
	errors: string[];
	skippedNoDate: number; // righe ignorate perché senza data (con skipInvalidDates)
	skippedZero: number; // righe a importo zero (informative)
}

/** Colonne mancanti o incoerenti nella mappatura; vuoto se va bene. */
export function mappingProblems(m: ColumnMapping, headers: string[]): string[] {
	const out: string[] = [];
	const has = (c: string) => c !== '' && headers.includes(c);
	if (!has(m.date)) out.push('Scegli la colonna della data.');
	if (!has(m.description)) out.push('Scegli la colonna della descrizione.');
	if (m.amountMode === 'signed' && !has(m.amount)) out.push("Scegli la colonna dell'importo.");
	if (m.amountMode === 'split' && !has(m.moneyIn) && !has(m.moneyOut)) out.push('Scegli la colonna delle entrate e/o delle uscite.');
	for (const [label, c] of [
		['seconda descrizione', m.description2],
		['card', m.card],
		['categoria', m.category]
	] as const)
		if (c !== '' && !headers.includes(c)) out.push(`La colonna "${c}" (${label}) non c'è nel file.`);
	return out;
}

export function applyMapping(table: CsvTable, m: ColumnMapping, today = new Date().toISOString().slice(0, 10)): MappedResult {
	const result: MappedResult = { rows: [], errors: mappingProblems(m, table.headers), skippedNoDate: 0, skippedZero: 0 };
	if (result.errors.length > 0) return result;

	const idx = (c: string) => (c === '' ? -1 : table.headers.indexOf(c));
	const col = {
		date: idx(m.date),
		d1: idx(m.description),
		d2: idx(m.description2),
		amount: idx(m.amount),
		in: idx(m.moneyIn),
		out: idx(m.moneyOut),
		card: idx(m.card),
		category: idx(m.category)
	};

	for (const { line, fields } of table.rows) {
		const get = (i: number) => (i < 0 ? '' : (fields[i] ?? '').trim());
		const date = parseDateAs(get(col.date), m.dateFormat);
		if (!date) {
			if (m.skipInvalidDates) result.skippedNoDate++;
			else result.errors.push(`Riga ${line}: data non valida "${get(col.date)}".`);
			continue;
		}
		if (date > today) {
			result.errors.push(`Riga ${line}: data nel futuro (${date}).`);
			continue;
		}
		const description = [get(col.d1), get(col.d2)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
		if (!description) {
			result.errors.push(`Riga ${line}: descrizione vuota.`);
			continue;
		}

		let amount: number;
		if (m.amountMode === 'signed') {
			amount = parseAmountAs(get(col.amount), m.decimal);
			if (m.invert) amount = -amount;
		} else {
			const inRaw = get(col.in);
			const outRaw = get(col.out);
			if (inRaw === '' && outRaw === '') {
				result.errors.push(`Riga ${line}: né entrata né uscita.`);
				continue;
			}
			const inV = inRaw === '' ? 0 : parseAmountAs(inRaw, m.decimal);
			const outV = outRaw === '' ? 0 : parseAmountAs(outRaw, m.decimal);
			// le uscite possono essere scritte positive o negative: conta il valore assoluto
			amount = Math.abs(inV) - Math.abs(outV);
		}
		if (!Number.isFinite(amount)) {
			result.errors.push(`Riga ${line}: importo non valido.`);
			continue;
		}
		amount = Math.round(amount * 100) / 100;
		if (amount === 0) {
			result.skippedZero++;
			continue;
		}

		const categoryRaw = get(col.category);
		result.rows.push({
			line,
			date,
			description,
			card: get(col.card) || null,
			amount,
			category: categoryRaw === '' || categoryRaw.toLowerCase() === 'unknown' ? null : categoryRaw
		});
	}
	return result;
}

/** Mappatura dal form (campi `m_*`), con valori ammessi soltanto. */
export function mappingFromForm(form: FormData): ColumnMapping {
	const s = (k: string) => String(form.get(`m_${k}`) ?? '').trim();
	const pick = <T extends string>(v: string, allowed: readonly T[], fallback: T): T =>
		(allowed as readonly string[]).includes(v) ? (v as T) : fallback;
	return {
		skipRows: Math.max(0, Math.min(500, (Number.parseInt(s('header_line'), 10) || 1) - 1)),
		date: s('date'),
		dateFormat: pick(s('date_format'), ['auto', 'dmy', 'ymd', 'mdy'] as const, 'auto'),
		description: s('description'),
		description2: s('description2'),
		amountMode: pick(s('amount_mode'), ['signed', 'split'] as const, 'signed'),
		amount: s('amount'),
		invert: form.get('m_invert') === 'on',
		moneyIn: s('money_in'),
		moneyOut: s('money_out'),
		decimal: pick(s('decimal'), ['auto', 'comma', 'dot'] as const, 'auto'),
		card: s('card'),
		category: s('category'),
		skipInvalidDates: form.get('m_skip_invalid') === 'on'
	};
}

// ---------------------------------------------------------------- profili

export interface ImportProfile {
	name: string;
	signature: string;
	mapping: ColumnMapping;
	updated_at: string;
}

/** Firma di un formato: l'intestazione normalizzata. */
export const headerSignature = (headers: string[]) => headers.map(normHeader).join('|');

export function listProfiles(): ImportProfile[] {
	return (
		db.prepare('SELECT name, signature, mapping, updated_at FROM import_profiles ORDER BY name').all() as {
			name: string;
			signature: string;
			mapping: string;
			updated_at: string;
		}[]
	).map((r) => ({ ...r, mapping: { ...EMPTY_MAPPING, ...JSON.parse(r.mapping) } }));
}

export function getProfile(name: string): ImportProfile | null {
	return listProfiles().find((p) => p.name === name) ?? null;
}

/** Il profilo il cui formato coincide con quello del file, con la tabella già letta. */
export function findProfileFor(text: string): { profile: ImportProfile; table: CsvTable } | null {
	for (const profile of listProfiles()) {
		const table = readCsvTable(text, profile.mapping.skipRows);
		if (headerSignature(table.headers) === profile.signature) return { profile, table };
	}
	return null;
}

export function saveProfile(name: string, headers: string[], mapping: ColumnMapping) {
	db.prepare(
		`INSERT INTO import_profiles (name, signature, mapping, updated_at) VALUES (?, ?, ?, datetime('now'))
		 ON CONFLICT(name) DO UPDATE SET signature = excluded.signature, mapping = excluded.mapping, updated_at = excluded.updated_at`
	).run(name, headerSignature(headers), JSON.stringify(mapping));
}

export function deleteProfile(name: string): boolean {
	return db.prepare('DELETE FROM import_profiles WHERE name = ?').run(name).changes > 0;
}
