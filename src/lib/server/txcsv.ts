/**
 * Parser CSV per import transazioni (append allo storico).
 *
 * Formato: prima riga di intestazione, separatore `;` o `,` (autodetect).
 * Colonne (case-insensitive): data, tipo, quantita, prezzo + almeno una tra
 * strumento e isin; commissioni, broker, note sono opzionali.
 * - data: YYYY-MM-DD oppure DD/MM/YYYY
 * - strumento: simbolo dello strumento (es. SWDA.MI, bitcoin), deve esistere
 * - isin: ISIN dello strumento (es. IE00B4L5Y983), deve essere censito in anagrafica.
 *   Se presente ha la precedenza sul simbolo; se entrambi risolvono a strumenti
 *   diversi la riga è un errore.
 * - tipo: buy/sell oppure acquisto/vendita
 * - numeri: virgola o punto decimale
 * - broker: nome (deve esistere), vuoto = nessuno
 */

export interface CsvInstrument {
	id: number;
	symbol: string;
	isin?: string | null;
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

const REQUIRED = ['data', 'tipo', 'quantita', 'prezzo'] as const;
/** Identificativo dello strumento: ne basta una delle due in intestazione. */
const IDENTIFIERS = ['strumento', 'isin'] as const;
const OPTIONAL = ['commissioni', 'broker', 'note'] as const;

/** ISIN normalizzato per il confronto: maiuscolo, senza spazi o separatori. */
export function normIsin(raw: string): string {
	return raw.trim().toUpperCase().replace(/[\s.-]/g, '');
}

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
	for (const name of [...REQUIRED, ...IDENTIFIERS, ...OPTIONAL]) {
		const idx = header.indexOf(name);
		if (idx >= 0) col[name] = idx;
	}
	const missing = REQUIRED.filter((name) => !(name in col));
	if (missing.length > 0)
		return { rows, errors: [`Intestazione: colonne mancanti: ${missing.join(', ')}. Attese: ${REQUIRED.join(', ')} + strumento e/o isin (+ ${OPTIONAL.join(', ')} opzionali).`] };
	if (!IDENTIFIERS.some((name) => name in col))
		return { rows, errors: ['Intestazione: serve almeno una colonna tra "strumento" (simbolo) e "isin".'] };

	const bySymbol = new Map(instruments.map((i) => [i.symbol.toLowerCase(), i.id]));
	// Un ISIN censito su più strumenti è ambiguo: lo si segnala invece di scegliere a caso.
	const byIsin = new Map<string, number[]>();
	for (const i of instruments) {
		if (!i.isin) continue;
		const key = normIsin(i.isin);
		if (key === '') continue;
		byIsin.set(key, [...(byIsin.get(key) ?? []), i.id]);
	}
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

		const symbol = get('strumento').trim();
		const isin = normIsin(get('isin'));
		if (symbol === '' && isin === '') {
			errors.push(`Riga ${lineNo}: manca l'identificativo dello strumento (simbolo o ISIN).`);
			continue;
		}

		// L'ISIN, se valorizzato, ha la precedenza; il simbolo serve da conferma.
		let instrument_id: number | undefined;
		if (isin !== '') {
			const matches = byIsin.get(isin);
			if (!matches) {
				errors.push(`Riga ${lineNo}: ISIN "${isin}" non trovato (censiscilo sullo strumento in Admin).`);
				continue;
			}
			if (matches.length > 1) {
				errors.push(`Riga ${lineNo}: ISIN "${isin}" associato a più strumenti: usa la colonna strumento (simbolo).`);
				continue;
			}
			instrument_id = matches[0];
			const bySym = symbol === '' ? undefined : bySymbol.get(symbol.toLowerCase());
			if (bySym !== undefined && bySym !== instrument_id) {
				errors.push(`Riga ${lineNo}: simbolo "${symbol}" e ISIN "${isin}" appartengono a strumenti diversi.`);
				continue;
			}
		} else {
			instrument_id = bySymbol.get(symbol.toLowerCase());
			if (!instrument_id) {
				errors.push(`Riga ${lineNo}: strumento "${symbol}" non trovato (usa il simbolo, es. SWDA.MI).`);
				continue;
			}
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
				errors.push(`Riga ${lineNo}: broker "${brokerRaw}" non trovato (crealo prima in Admin).`);
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
