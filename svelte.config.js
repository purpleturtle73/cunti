import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// app senza autenticazione su rete locale/VPN, raggiunta via IP o hostname
		// diversi: il check dell'header Origin richiederebbe un ORIGIN fisso
		csrf: { checkOrigin: false }
	}
};

export default config;
