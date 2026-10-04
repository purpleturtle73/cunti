import { fail } from '@sveltejs/kit';
import { findConflicts, resolveConflicts } from '$lib/server/expenses';
import type { Actions, PageServerLoad } from './$types';

/** Quante voci mostrare per gruppo: i gruppi grandi si risolvono in blocco. */
const ITEMS_PER_GROUP = 50;

/** Admin → Finanze → Conflitti: voci la cui categoria non coincide con quella
 *  che assegnerebbero le regole attuali. */
export const load: PageServerLoad = ({ url }) => {
	const locked = url.searchParams.get('vista') === 'bloccate';
	const groups = findConflicts(locked);
	const otherCount = findConflicts(!locked).reduce((s, g) => s + g.count, 0);
	return {
		locked,
		otherCount,
		total: groups.reduce((s, g) => s + g.count, 0),
		groups: groups.map((g) => ({
			...g,
			items: g.items.slice(0, ITEMS_PER_GROUP),
			hidden: Math.max(0, g.count - ITEMS_PER_GROUP)
		}))
	};
};

const ACTIONS = ['accept', 'keep', 'unlock'] as const;
type Act = (typeof ACTIONS)[number];
const isAct = (v: unknown): v is Act => ACTIONS.includes(v as Act);

const VERB: Record<Act, string> = {
	accept: 'categoria delle regole applicata',
	keep: 'tua categoria tenuta e bloccata',
	unlock: 'blocco tolto'
};

export const actions: Actions = {
	/** Un'azione su un'intera coppia (categoria attuale → categoria delle regole). */
	group: async ({ request }) => {
		const f = await request.formData();
		const act = f.get('act');
		if (!isAct(act)) return fail(400, { error: 'Azione non valida.' });
		const n = resolveConflicts(act, {
			category: String(f.get('category') || ''),
			ruleCategory: String(f.get('ruleCategory') || ''),
			locked: f.get('locked') === '1'
		});
		return { message: `${n} voci: ${VERB[act]}.` };
	},

	/** Un'azione su una singola voce. */
	item: async ({ request }) => {
		const f = await request.formData();
		const act = f.get('act');
		const id = Number(f.get('id'));
		if (!isAct(act) || !id) return fail(400, { error: 'Dati non validi.' });
		const n = resolveConflicts(act, { id });
		return { message: n ? `Voce aggiornata: ${VERB[act]}.` : 'La voce non è più in conflitto.' };
	}
};
