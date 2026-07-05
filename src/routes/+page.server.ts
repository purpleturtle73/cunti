import { buildSnapshot } from '$lib/server/portfolio';
import { buildTaxSummary } from '$lib/server/tax';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const snapshot = buildSnapshot();
	const tax = buildTaxSummary(snapshot.positions);
	return { snapshot, tax };
};
