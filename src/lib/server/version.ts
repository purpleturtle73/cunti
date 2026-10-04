/**
 * Versione dell'immagine in esecuzione.
 *
 * Viene fissata alla build dell'immagine (`ARG APP_VERSION` nel Containerfile → `ENV`)
 * e passata dalla CI: `1.2.3` sui tag `v*`, `main-<sha7>` sulle altre build.
 * Fuori da un'immagine (sviluppo, `npm run dev`) la variabile non c'è e vale `dev`.
 * Letta a runtime da `process.env`, non a build time: la stessa build di SvelteKit
 * resta valida e la versione dipende solo dall'immagine che la contiene.
 */
export const APP_VERSION = process.env.APP_VERSION?.trim() || 'dev';
