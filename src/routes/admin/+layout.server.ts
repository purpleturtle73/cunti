import { APP_VERSION } from '$lib/server/version';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => ({ version: APP_VERSION });
