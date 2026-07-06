/**
 * Parser CSV per import transazioni (append allo storico).
 *
 * Formato: prima riga di intestazione, separatore `;` o `,` (autodetect).
 * Colonne (case-insensitive): data, strumento, tipo, quantita, prezzo,
 * commissioni (opzionale), broker (opzionale), note (opzionale).
 * - data: YYYY-MM-DD oppure DD/MM/YYYY
 * - strumento: simbolo dello strumento (es. SWDA.MI, bitcoin), deve esistere
 * - tipo: buy/sell oppure acquisto/vendita
 * - numeri: virgola o punto decimale
 * - broker: nome (deve esistere), vuoto = nessuno
 */

export interface CsvInstrument {
	id: number;
	symbol: string;
}

export interface CsvBroker {
	id: number;
	name: string;
}

export interface ParsedTx {
	line: number; // riga nel file (1-based, header = 1)
	instrument_id: number;
	type: 'buy' | 'sell';
	date: string; // YYYY-MM-DD
	quantity: number;
	price: number;
	fee: number;
	notes: string | null;
	broker_id: number | null;
}

export interface CsvResult {
	rows: ParsedTx[];
	errors: string[];
}

const REQUIRED = ['data', 'strumento', 'tipo', 'quantita', 'prezzo'] as const;
const OPTIONAL = ['commissioni', 'broker', 'note'] as const;

/** Divide una riga CSV rispettando i campi tra doppi apici (con escape ""). */
export function splitLine(line: string, sep: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quoted) {
			if (ch === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (ch === '"') {
				quoted = false;
			} else {
				cur += ch;
			}
		} else if (ch === '"') {
			quoted = true;
		} else if (ch === sep) {
			out.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	out.push(cur);
	return out.map((s) => s.trim());
}

export function normHeader(h: string): string {
	return h
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, ''); // quantità → quantita
}

export function parseNumber(raw: string): number {
	let s = raw.trim().replace(/\s/g, '');
	if (s === '') return NaN;
	const lastComma = s.lastIndexOf(',');
	const lastDot = s.lastIndexOf('.');
	if (lastComma >= 0 && lastDot >= 0) {
		// entrambi presenti: l'ultimo è il decimale, l'altro separatore migliaia
		if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
		else s = s.replace(/,/g, '');
	} else if (lastComma >= 0) {
		s = s.replace(',', '.');
	}
	return Number(s);
}

export function parseDate(raw: string): string | null {
	const s = raw.trim();
	let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) {
		const it = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
		if (!it) return null;
		m = [s, it[3], it[2].padStart(2, '0'), it[1].padStart(2, '0')] as unknown as RegExpExecArray;
	}
	const iso = `${m[1]}-${m[2]}-${m[3]}`;
	const d = new Date(iso + 'T00:00:00Z');
	if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
	return iso;
}

const TYPES: Record<string, 'buy' | 'sell'> = {
	buy: 'buy',
	acquisto: 'buy',
	sell: 'sell',
	vendita: 'sell'
};

export function parseTransactionsCsv(
	text: string,
	instruments: CsvInstrument[],
	brokers: CsvBroker[]
): CsvResult {
	const errors: string[] = [];
	const rows: ParsedTx[] = [];

	const lines = text
		.replace(/^\ufeff/, '') // BOM (export Excel)
		.split(/\r\n|\r|\n/)
		.filter((l) => l.trim() !== '');
	if (lines.length < 2) return { rows, errors: ['File vuoto o senza righe dati.'] };

	const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
	const header = splitLine(lines[0], sep).map(normHeader);

	const col: Record<string, number> = {};
	for (const name of [...REQUIRED, ...OPTIONAL]) {
		const idx = header.indexOf(name);
		if (idx >= 0) col[name] = idx;
	}
	const missing = REQUIRED.filter((name) => !(name in col));
	if (missing.length > 0)
		return { rows, errors: [`Intestazione: colonne mancanti: ${missing.join(', ')}. Attese: ${REQUIRED.join(', ')} (+ ${OPTIONAL.join(', ')} opzionali).`] };

	const bySymbol = new Map(instruments.map((i) => [i.symbol.toLowerCase(), i.id]));
	const byBroker = new Map(brokers.map((b) => [b.name.toLowerCase(), b.id]));
	const today = new Date().toISOString().slice(0, 10);

	for (let n = 1; n < lines.length; n++) {
		const fields = splitLine(lines[n], sep);
		const get = (name: string) => (name in col ? (fields[col[name]] ?? '') : '');
		const lineNo = n + 1;

		const date = parseDate(get('data'));
		if (!date) {
			errors.push(`Riga ${lineNo}: data non valida "${get('data')}" (usa YYYY-MM-DD o DD/MM/YYYY).`);
			continue;
		}
		if (date > today) {
			errors.push(`Riga ${lineNo}: data nel futuro (${date}).`);
			continue;
		}

		const symbol = get('strumento');
		const instrument_id = bySymbol.get(symbol.toLowerCase());
		if (!instrument_id) {
			errors.push(`Riga ${lineNo}: strumento "${symbol}" non trovato (usa il simbolo, es. SWDA.MI).`);
			continue;
		}

		const type = TYPES[get('tipo').toLowerCase()];
		if (!type) {
			errors.push(`Riga ${lineNo}: tipo non valido "${get('tipo')}" (buy/sell o acquisto/vendita).`);
			continue;
		}

		const quantity = parseNumber(get('quantita'));
		if (!Number.isFinite(quantity) || quantity <= 0) {
			errors.push(`Riga ${lineNo}: quantità non valida "${get('quantita')}".`);
			continue;
		}

		const price = parseNumber(get('prezzo'));
		if (!Number.isFinite(price) || price < 0) {
			errors.push(`Riga ${lineNo}: prezzo non valido "${get('prezzo')}".`);
			continue;
		}

		const feeRaw = get('commissioni');
		const fee = feeRaw === '' ? 0 : parseNumber(feeRaw);
		if (!Number.isFinite(fee) || fee < 0) {
			errors.push(`Riga ${lineNo}: commissioni non valide "${feeRaw}".`);
			continue;
		}

		const brokerRaw = get('broker');
		let broker_id: number | null = null;
		if (brokerRaw !== '') {
			broker_id = byBroker.get(brokerRaw.toLowerCase()) ?? null;
			if (!broker_id) {
				errors.push(`Riga ${lineNo}: broker "${brokerRaw}" non trovato (crealo prima in Amministrazione).`);
				continue;
			}
		}

		rows.push({
			line: lineNo,
			instrument_id,
			type,
			date,
			quantity,
			price,
			fee,
			notes: get('note').trim() || null,
			broker_id
		});
	}

	return { rows, errors };
}
