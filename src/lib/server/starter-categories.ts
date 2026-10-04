/**
 * Set di categorie suggerito, in stile app bancaria: poche categorie ampie invece di
 * molte di nicchia, così i totali restano leggibili.
 *
 * È un **punto di partenza**: si carica automaticamente solo su un'installazione
 * vuota (nessuna categoria e nessuna spesa), altrimenti si aggiunge dal pulsante
 * "Aggiungi set suggerito" nella pagina Categorie, che non tocca quelle esistenti.
 *
 * Le keyword sono generiche (catene, servizi e termini bancari diffusi in Italia) e
 * vanno personalizzate. Il match è substring senza maiuscole e vince la più lunga,
 * quindi keyword corte e comuni vanno evitate: "bar" matcherebbe anche "barbiere".
 * Stesso formato del JSON di import/export.
 */
import type { CategoriesJson } from './categorize';

export const STARTER_CATEGORIES: CategoriesJson = {
	spesa: {
		icon: 'cart',
		keywords: [
			'esselunga',
			'conad',
			'coop',
			'carrefour',
			'lidl',
			'eurospin',
			'despar',
			'penny market',
			'aldi',
			'famila',
			'bennet',
			'tigros',
			'supermercat',
			'alimentari'
		]
	},
	ristoranti: {
		icon: 'food',
		keywords: [
			'ristorante',
			'pizzeria',
			'trattoria',
			'osteria',
			'caffetteria',
			'mcdonald',
			'burger king',
			'deliveroo',
			'just eat',
			'glovo',
			'gelateria',
			'pasticceria'
		]
	},
	trasporti: {
		icon: 'transport',
		keywords: [
			'trenitalia',
			'italo treno',
			'autostrade',
			'telepass',
			'carburant',
			'enilive',
			'tamoil',
			'parcheggio',
			'uber',
			'freenow',
			'abbonamento atm'
		]
	},
	casa: {
		icon: 'home',
		keywords: ['affitto', 'condominio', 'rata mutuo', 'ikea', 'leroy merlin', 'bricocenter']
	},
	bollette: {
		icon: 'bill',
		keywords: [
			'enel energia',
			'a2a energia',
			'hera comm',
			'iren mercato',
			'edison energia',
			'sorgenia',
			'bolletta',
			'vodafone',
			'windtre',
			'iliad',
			'fastweb',
			'telecom italia'
		]
	},
	salute: {
		icon: 'health',
		keywords: ['farmacia', 'parafarmacia', 'ticket sanitario', 'dentista', 'poliambulatorio', 'ottica', 'palestra']
	},
	shopping: {
		icon: 'shopping',
		keywords: ['amazon', 'zalando', 'decathlon', 'zara', 'h&m', 'mediaworld', 'unieuro', 'ovs']
	},
	viaggi: {
		icon: 'travel',
		keywords: ['booking.com', 'airbnb', 'ryanair', 'easyjet', 'ita airways', 'hotel', 'expedia']
	},
	svago: {
		icon: 'fun',
		keywords: ['cinema', 'teatro', 'ticketone', 'museo', 'steam', 'playstation']
	},
	abbonamenti: {
		icon: 'digital',
		keywords: [
			'netflix',
			'spotify',
			'disney plus',
			'amazon prime',
			'apple.com',
			'google storage',
			'icloud',
			'dazn',
			'youtube premium'
		]
	},
	banca_tasse: {
		icon: 'bank',
		keywords: ['commissioni', 'canone conto', 'imposta di bollo', 'pagamento f24', 'interessi passivi']
	},
	stipendio: {
		icon: 'salary',
		keywords: ['stipendio', 'emolumenti', 'stipendi e pensioni']
	},
	entrate_altre: {
		icon: 'income',
		keywords: ['rimborso', 'cashback', 'bonifico a vostro favore']
	},
	contanti: {
		icon: 'cash',
		keywords: ['prelievo', 'prelevamento']
	},
	trasferimenti: {
		icon: 'transfer',
		transfer: true,
		keywords: ['giroconto', 'ricarica carta', 'saldo carta di credito']
	},
	altro: {
		icon: 'misc',
		keywords: []
	}
};
