/**
 * Dati demo generati dall'app (Admin → Finanze / Investimenti), per provare tutte le
 * pagine senza i propri dati. Deterministici (PRNG con seme fisso) e con date relative a
 * oggi, così un DB demo resta "attuale".
 *
 * Funzionano **solo su una sezione vuota**: in produzione non si devono poter mescolare
 * dati finti e veri per sbaglio. Con dati presenti si svuota prima (lo svuotamento fa
 * già un backup). Il demo Finanze sostituisce anche categorie e card configurate, dopo
 * un proprio backup: un demo deve mostrare solo nomi demo.
 */
import { createBackup } from './backup';
import { ensureCategoriesMigrated, importCategories, loadRules, matchCategory } from './categorize';
import { db } from './db';
import { setBudgets } from './expenses';
import { log } from './log';
import { STARTER_CATEGORIES } from './starter-categories';

/** I simboli demo iniziano così: il refresh prezzi li salta (non esistono su Yahoo/CoinGecko). */
export const DEMO_SYMBOL_PREFIX = 'DEMO';
export const isDemoSymbol = (symbol: string) => symbol.toUpperCase().startsWith(DEMO_SYMBOL_PREFIX);

function mulberry32(seed: number) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- Finanze

export interface DemoFinanceReport {
	inserted: number;
	categories: number; // categorie del set di default, ora le sole definite
	cards: number;
	unknown: number;
	conflicts: number;
	backup: string; // nome del backup fatto prima di sostituire categorie e card
}

// Conti e carte demo, con nomi volutamente generici. Ruoli: A è il conto principale
// (stipendio, affitto, prelievi), B paga le utenze, C le spese personali; il trading
// riceve il giroconto mensile; le tre carte si dividono le spese variabili.
const CC_A = 'Conto Corrente A';
const CC_B = 'Conto Corrente B';
const CC_C = 'Conto Corrente C';
const TRADING_A = 'Conto Trading A';
const CARTA_A = 'Carta Credito A';
const CARTA_B = 'Carta Credito B';
const CARTA_C = 'Carta Credito C';

/** Card configurate dal demo (Admin → Finanze → card/conti), con un logo-lettera per tipo. */
const DEMO_CARDS: { name: string; bg: string; letter: string }[] = [
	{ name: CC_A, bg: '#3987e5', letter: 'A' },
	{ name: CC_B, bg: '#3987e5', letter: 'B' },
	{ name: CC_C, bg: '#3987e5', letter: 'C' },
	{ name: TRADING_A, bg: '#199e70', letter: 'A' },
	{ name: CARTA_A, bg: '#d95926', letter: 'A' },
	{ name: CARTA_B, bg: '#d95926', letter: 'B' },
	{ name: CARTA_C, bg: '#d95926', letter: 'C' }
];
export const DEMO_CARD_NAMES = DEMO_CARDS.map((c) => c.name);

/** Budget mensili del demo (categorie del set di default). */
export const DEMO_BUDGETS: Record<string, number> = {
	spesa: 380,
	ristoranti: 140,
	trasporti: 220,
	shopping: 150,
	svago: 30,
	abbonamenti: 30,
	salute: 60
};

/** Una voce da generare: descrizione, importo (segno incluso), card. */
interface DemoRow {
	date: string;
	description: string;
	amount: number;
	card: string;
	/** categoria forzata (conflitti): `manual` = scelta bloccata dall'utente */
	force?: { category: string; manual: 0 | 1 };
}

function financeRows(today: Date, months = 24): DemoRow[] {
	const rnd = mulberry32(20261004);
	const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
	const between = (lo: number, hi: number) => round2(lo + rnd() * (hi - lo));
	const rows: DemoRow[] = [];
	const todayIso = isoDay(today);

	for (let k = months - 1; k >= 0; k--) {
		const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - k, 1));
		const y = first.getUTCFullYear();
		const m = first.getUTCMonth();
		const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
		const on = (day: number) => isoDay(new Date(Date.UTC(y, m, Math.min(day, daysInMonth))));
		const anyDay = () => on(1 + Math.floor(rnd() * daysInMonth));
		const add = (r: DemoRow) => {
			if (r.date <= todayIso) rows.push(r);
		};
		const mm = String(m + 1).padStart(2, '0');

		// entrate e costi fissi
		add({ date: on(27), description: `ACCREDITO STIPENDIO ACME SRL ${mm}/${y}`, amount: k < 12 ? 2380 : 2290, card: CC_A });
		add({ date: on(3), description: 'ADDEBITO AFFITTO APPARTAMENTO', amount: -750, card: CC_A });
		add({ date: on(1), description: 'CANONE CONTO MENSILE', amount: -2.5, card: CC_A });
		if (m % 3 === 2) add({ date: on(28), description: 'IMPOSTA DI BOLLO E/C', amount: -8.55, card: CC_A });
		add({ date: on(20), description: 'TELEPASS SPA ADDEBITO PEDAGGI', amount: -between(14, 42), card: CC_A });
		// giroconto mensile verso il conto trading: le due gambe, entrambe escluse dai totali
		add({ date: on(28), description: 'GIROCONTO VERSO CONTO TRADING A', amount: -300, card: CC_A });
		add({ date: on(28), description: 'GIROCONTO DA CONTO CORRENTE A', amount: 300, card: TRADING_A });
		if (m === 5 || m === 11) add({ date: on(30), description: 'IMPOSTA DI BOLLO DOSSIER TITOLI', amount: -between(8, 14), card: TRADING_A });
		add({ date: on(5), description: 'CONDOMINIO VIA DEI MILLE SPESE ORDINARIE', amount: m % 3 === 0 ? -180 : 0, card: CC_B });
		add({ date: on(8), description: 'ADDEBITO SDD ILIAD MOBILE', amount: -9.99, card: CC_B });
		add({ date: on(10), description: 'ADDEBITO SDD FASTWEB SPA FIBRA', amount: -29.95, card: CC_B });
		if (m % 2 === 0) add({ date: on(18), description: 'ADDEBITO SDD ENEL ENERGIA BOLLETTA', amount: -between(62, 118), card: CC_B });
		add({ date: on(2), description: 'PALESTRA FIT CENTER QUOTA MENSILE', amount: -39, card: CC_C });
		add({ date: on(12), description: 'NETFLIX.COM AMSTERDAM', amount: k < 10 ? -13.99 : -12.99, card: CARTA_B });
		add({ date: on(15), description: 'SPOTIFY STOCKHOLM', amount: -10.99, card: CARTA_B });

		// spese variabili
		for (let i = 0; i < 6; i++)
			add({ date: anyDay(), description: `PAGAMENTO POS ${pick(['ESSELUNGA', 'CONAD', 'LIDL', 'COOP'])} ${pick(['MILANO', 'MONZA'])}`, amount: -between(14, 115), card: pick([CARTA_A, CARTA_A, CC_C]) });
		for (let i = 0; i < 4; i++)
			add({ date: anyDay(), description: pick(['PIZZERIA BELLA NAPOLI', 'TRATTORIA DA GINO', 'DELIVEROO ITALY', "MCDONALD'S 512"]), amount: -between(9, 58), card: pick([CARTA_B, CARTA_B, CC_C]) });
		for (let i = 0; i < 2; i++) add({ date: anyDay(), description: 'ENILIVE STAZIONE SERVIZIO', amount: -between(40, 72), card: CARTA_C });
		if (rnd() < 0.7) add({ date: anyDay(), description: 'TRENITALIA WEB BIGLIETTO', amount: -between(9, 48), card: CARTA_C });
		if (rnd() < 0.8) add({ date: anyDay(), description: 'FARMACIA COMUNALE', amount: -between(6, 38), card: CC_C });
		for (let i = 0; i < 2; i++) add({ date: anyDay(), description: 'AMAZON EU SARL MARKETPLACE', amount: -between(9, 85), card: CARTA_A });
		if (rnd() < 0.25) add({ date: anyDay(), description: 'ZALANDO SE', amount: -between(30, 120), card: CARTA_B });
		if (rnd() < 0.35) add({ date: anyDay(), description: 'CINEMA MULTISALA ODEON', amount: -between(8, 24), card: CARTA_B });
		if (rnd() < 0.85) add({ date: anyDay(), description: 'PRELIEVO ATM', amount: -pick([50, 100, 150]), card: CC_A });
		if (rnd() < 0.3) add({ date: anyDay(), description: 'CASHBACK CARTA', amount: between(2, 15), card: CARTA_A });
		if (rnd() < 0.15) add({ date: anyDay(), description: 'RIMBORSO SPESE MEDICHE', amount: between(25, 90), card: CC_C });
		// voci che nessuna regola riconosce: restano "unknown", da categorizzare
		for (let i = 0; i < 3; i++)
			add({ date: anyDay(), description: `PAGAMENTO POS ESERCENTE ${String(100 + Math.floor(rnd() * 900))}`, amount: -between(4, 60), card: pick([CARTA_A, CARTA_C, CC_C]) });

		// vacanze: estate e dicembre, con due cene categorizzate "viaggi" dal CSV della
		// banca (le regole direbbero "ristoranti": conflitti da rivedere)
		if (m === 7 || m === 11) {
			// compagnia a rotazione: un volo che torna ogni sei mesi non è un abbonamento
			const airline = ['RYANAIR DAC', 'EASYJET AIRLINE', 'ITA AIRWAYS'][(y * 2 + (m === 7 ? 0 : 1)) % 3];
			add({ date: on(4), description: airline, amount: -between(90, 220), card: CARTA_C });
			add({ date: on(6), description: 'BOOKING.COM HOTEL', amount: -between(180, 420), card: CARTA_C });
			for (const d of [12, 13])
				add({ date: on(d), description: 'TRATTORIA AL PORTO', amount: -between(35, 80), card: CARTA_C, force: { category: 'viaggi', manual: 0 } });
		}
		// mobili comprati su Amazon: scelta "casa" bloccata a mano (conflitti bloccati)
		if (k === 9 || k === 4)
			add({ date: on(22), description: 'AMAZON EU SARL MARKETPLACE', amount: -between(120, 260), card: CARTA_A, force: { category: 'casa', manual: 1 } });
	}
	return rows.filter((r) => r.amount !== 0);
}

export function hasExpenses(): boolean {
	return db.prepare('SELECT 1 FROM expenses LIMIT 1').get() !== undefined;
}

/**
 * Movimenti demo su una configurazione **solo demo**: categorie e keyword vengono
 * sostituite dal set di default e le card configurate dalle 7 card demo. Con le categorie
 * dell'utente ancora presenti, le sue keyword (es. "esselunga" sotto una sua categoria)
 * catturerebbero i movimenti demo e il demo mostrerebbe i suoi nomi. Prima viene fatto un
 * backup, quindi la configurazione dell'utente resta recuperabile. `null` se ci sono già
 * movimenti.
 */
export async function createDemoFinances(today = new Date()): Promise<DemoFinanceReport | null> {
	if (hasExpenses()) return null;
	ensureCategoriesMigrated(); // la migrazione dei vecchi json non deve ripartire dopo
	const backup = await createBackup();
	// il backup è asincrono: nel frattempo può essere arrivato un import
	if (hasExpenses()) return null;
	const cats = importCategories(STARTER_CATEGORIES, 'replace');
	const { rules } = loadRules();

	const rows = financeRows(today);
	let unknown = 0;
	let conflicts = 0;
	const ins = db.prepare(
		'INSERT INTO expenses (date, description, card, amount, category, category_manual) VALUES (?, ?, ?, ?, ?, ?)'
	);
	db.transaction(() => {
		for (const r of rows) {
			let category = matchCategory(r.description, rules)?.category ?? 'unknown';
			let manual: 0 | 1 = 0;
			if (r.force) {
				category = r.force.category;
				manual = r.force.manual;
				conflicts++;
			}
			if (category === 'unknown') unknown++;
			ins.run(r.date, r.description, r.card, r.amount, category, manual);
		}
		// qualche budget mensile, tarato sui movimenti demo: alcuni mesi si sfora
		setBudgets(new Map(Object.entries(DEMO_BUDGETS)));
		// solo i conti e le carte demo, con logo
		db.prepare('DELETE FROM cards').run();
		const insCard = db.prepare('INSERT INTO cards (name, logo, logo_mime) VALUES (?, ?, ?)');
		for (const c of DEMO_CARDS) insCard.run(c.name, logoSvg(c.bg, c.letter), 'image/svg+xml');
	})();
	log('demo', `finanze: ${rows.length} movimenti demo, categorie e card sostituite (backup ${backup.name})`);
	return { inserted: rows.length, categories: cats.categoriesAdded, cards: DEMO_CARDS.length, unknown, conflicts, backup: backup.name };
}

// ---------------------------------------------------------------- Investimenti

export interface DemoInvestmentsReport {
	instruments: number;
	prices: number;
	operations: number;
}

export function hasTransactions(): boolean {
	return db.prepare('SELECT 1 FROM transactions LIMIT 1').get() !== undefined;
}

function logoSvg(bg: string, letter: string): Buffer {
	return Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${bg}"/><text x="16" y="22" font-family="sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`
	);
}

/**
 * Due ETF (EUR) e una crypto (USD) con ~2 anni di prezzi sintetici, cambio EURUSD, due
 * broker con logo, un PAC mensile di 18 rate, acquisti crypto sparsi e una vendita.
 * `null` se ci sono già operazioni. Strumenti e broker demo già presenti (es. dopo uno
 * svuotamento) vengono riusati; i cambi reali già scaricati non vengono sovrascritti.
 */
export function createDemoInvestments(today = new Date()): DemoInvestmentsReport | null {
	if (hasTransactions()) return null;
	const DAYS = 730;
	const day = (offset: number) => {
		const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
		d.setUTCDate(d.getUTCDate() - offset);
		return isoDay(d);
	};
	const randomWalk = (seed: number, start: number, driftPerDay: number, vol: number) => {
		const rnd = mulberry32(seed);
		const out: { date: string; close: number }[] = [];
		let px = start;
		for (let i = DAYS; i >= 0; i--) {
			px *= 1 + driftPerDay + (rnd() - 0.5) * vol;
			out.push({ date: day(i), close: px });
		}
		return out;
	};
	const priceOn = (series: { date: string; close: number }[], date: string) => {
		let last = series[0].close;
		for (const p of series) {
			if (p.date > date) break;
			last = p.close;
		}
		return round2(last);
	};

	let prices = 0;
	let operations = 0;
	db.transaction(() => {
		const brokerId = (name: string, bg: string, letter: string) => {
			db.prepare('INSERT OR IGNORE INTO brokers (name, logo, logo_mime) VALUES (?, ?, ?)').run(name, logoSvg(bg, letter), 'image/svg+xml');
			return (db.prepare('SELECT id FROM brokers WHERE name = ?').get(name) as { id: number }).id;
		};
		const bank = brokerId('Banca Demo', '#3987e5', 'B');
		const exchange = brokerId('Exchange Demo', '#9085e9', 'X');

		const instrumentId = (symbol: string, name: string, type: 'etf' | 'crypto', isin: string | null, ter: number, currency: string) => {
			db.prepare(
				'INSERT OR IGNORE INTO instruments (symbol, name, type, isin, ter_pct, tax_rate_pct, currency) VALUES (?, ?, ?, ?, ?, 26, ?)'
			).run(symbol, name, type, isin, ter, currency);
			return (db.prepare('SELECT id FROM instruments WHERE symbol = ?').get(symbol) as { id: number }).id;
		};
		const world = instrumentId('DEMOW.MI', 'ETF Azionario Globale (demo)', 'etf', 'IE00DEMO0001', 0.2, 'EUR');
		const bond = instrumentId('DEMOB.MI', 'ETF Bilanciato 80/20 (demo)', 'etf', 'IE00DEMO0002', 0.25, 'EUR');
		const coin = instrumentId('DEMOCOIN', 'Democoin', 'crypto', null, 0, 'USD');

		const series = new Map([
			[world, randomWalk(1, 78, 0.00045, 0.014)],
			[bond, randomWalk(2, 27, 0.0003, 0.009)],
			[coin, randomWalk(3, 36000, 0.001, 0.05)] // in USD
		]);
		const insPx = db.prepare('INSERT OR REPLACE INTO prices (instrument_id, date, close) VALUES (?, ?, ?)');
		for (const [id, rows] of series)
			for (const r of rows) {
				insPx.run(id, r.date, r.close);
				prices++;
			}
		const insFx = db.prepare("INSERT OR IGNORE INTO fx_rates (pair, date, rate) VALUES ('EURUSD', ?, ?)");
		for (const r of randomWalk(4, 1.08, 0, 0.004)) insFx.run(r.date, r.close);

		const insTx = db.prepare(
			'INSERT INTO transactions (instrument_id, type, date, quantity, price, fee, notes, broker_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
		);
		const tx = (id: number, type: 'buy' | 'sell', d: string, qty: number, fee: number, notes: string, broker: number) => {
			insTx.run(id, type, d, qty, priceOn(series.get(id)!, d), fee, notes, broker);
			operations++;
		};
		// PAC mensile: 18 rate su due ETF, via banca
		for (let m = 18; m >= 1; m--) {
			const d = day(m * 30);
			tx(world, 'buy', d, 3, 4.9, 'PAC mensile', bank);
			tx(bond, 'buy', d, 6, 4.9, 'PAC mensile', bank);
		}
		// crypto (in USD): acquisti sparsi e una presa di profitto, via exchange
		for (const m of [17, 13, 9, 5]) tx(coin, 'buy', day(m * 30), 0.01, 6, 'DCA', exchange);
		tx(coin, 'sell', day(60), 0.015, 8, 'presa di profitto', exchange);
	})();
	log('demo', `investimenti: 3 strumenti, ${prices} prezzi, ${operations} operazioni demo`);
	return { instruments: 3, prices, operations };
}
