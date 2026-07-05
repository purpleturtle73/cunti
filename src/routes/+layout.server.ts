import { getSetting } from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	return { lastRefresh: getSetting('last_refresh') };
};
