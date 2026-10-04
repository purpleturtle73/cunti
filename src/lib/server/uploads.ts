/** Limiti degli upload, condivisi dalle pagine di amministrazione.
 *  Il tetto assoluto per qualunque body è BODY_SIZE_LIMIT di adapter-node
 *  (200M nel Containerfile); questi sono i limiti applicativi, più stretti. */

export const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
export const LOGO_MAX_BYTES = 512 * 1024;
export const UPLOAD_MAX_BYTES = 200 * 1024 * 1024; // file .db di backup
export const TX_CSV_MAX_BYTES = 2 * 1024 * 1024;
export const EXPENSE_CSV_MAX_BYTES = 20 * 1024 * 1024;
export const CATEGORIES_JSON_MAX_BYTES = 1024 * 1024;
