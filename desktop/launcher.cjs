// Avvio di Cunti come eseguibile unico (Node.js Single Executable Application).
//
// L'eseguibile è node con dentro, come "asset", il server già compilato e il modulo
// nativo di SQLite. Al primo avvio (e a ogni nuova versione) li estrae in una cartella
// di cache dell'utente e avvia il server da lì; database e backup stanno invece nella
// cartella dell'eseguibile: spostare o copiare quella cartella = spostare i dati.
//
// Gira come main script della SEA: qui `require` carica solo moduli built-in, quindi il
// server (ESM) viene caricato con un import() da un piccolo modulo CommonJS estratto.
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const sea = require('node:sea');

const env = process.env;
const exeDir = path.dirname(process.execPath);

/** Errore bloccante: con il doppio clic la finestra si chiuderebbe prima di leggerlo. */
function fatal(message, err) {
	console.error(`\n[cunti] ${message}`);
	if (err) console.error(err && err.stack ? err.stack : err);
	if (process.stdin.isTTY) {
		console.error('\nPremi Invio per chiudere.');
		process.stdin.resume();
		process.stdin.once('data', () => process.exit(1));
	} else {
		process.exit(1);
	}
}

process.on('uncaughtException', (err) => {
	if (err && err.code === 'EADDRINUSE')
		fatal(`La porta ${env.PORT} è già in uso: Cunti è già aperto? Altrimenti avvialo con un'altra porta (variabile PORT).`);
	else fatal('Errore imprevisto.', err);
});

// ---------------------------------------------------------------- estrazione

function extract(manifest, cacheRoot, appDir) {
	// cartella temporanea + rename: un'estrazione interrotta non lascia una copia a metà
	const tmp = `${appDir}.tmp-${process.pid}`;
	fs.rmSync(tmp, { recursive: true, force: true });
	for (const rel of manifest.files) {
		const dest = path.join(tmp, ...rel.split('/'));
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, Buffer.from(sea.getAsset(rel)));
	}
	fs.writeFileSync(path.join(tmp, '.complete'), manifest.version);
	fs.rmSync(appDir, { recursive: true, force: true });
	fs.renameSync(tmp, appDir);
	// versioni precedenti: si tolgono se nessuno le sta usando (su Windows un .node
	// caricato non si cancella: si riproverà al prossimo aggiornamento)
	for (const d of fs.readdirSync(cacheRoot)) {
		if (d === manifest.hash) continue;
		try {
			fs.rmSync(path.join(cacheRoot, d), { recursive: true, force: true });
		} catch {
			/* in uso */
		}
	}
}

// ---------------------------------------------------------------- avvio

function openBrowser(url) {
	const [cmd, args] =
		process.platform === 'win32'
			? ['explorer.exe', [url]]
			: process.platform === 'darwin'
				? ['open', [url]]
				: ['xdg-open', [url]];
	try {
		spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
	} catch {
		/* nessun browser: resta l'indirizzo stampato */
	}
}

function whenReady(manifest, attempt = 0) {
	const url = `http://127.0.0.1:${env.PORT}/`;
	const retry = () => (attempt < 60 ? setTimeout(() => whenReady(manifest, attempt + 1), 250) : null);
	http
		.get(`${url}api/health`, (res) => {
			res.resume();
			if (res.statusCode !== 200) return retry();
			console.log(
				`\n  Cunti ${manifest.version} è in esecuzione: ${url}\n` +
					`  Dati: ${env.DATA_DIR}\n` +
					'  Chiudi questa finestra per fermarlo.\n'
			);
			if (!env.CUNTI_NO_BROWSER) openBrowser(url);
		})
		.on('error', retry);
}

function main() {
	if (!sea.isSea()) return fatal('Questo file va eseguito come parte di cunti.exe (vedi desktop/build-exe.mjs).');

	// Configurazione: le variabili d'ambiente già impostate vincono sui default.
	env.DATA_DIR ||= exeDir; // database e backup accanto all'eseguibile
	env.PORT ||= '3030';
	env.HOST ||= '127.0.0.1'; // solo da questo PC: l'app non ha autenticazione
	env.ORIGIN ||= `http://127.0.0.1:${env.PORT}`; // senza, il server si crede in https
	env.BODY_SIZE_LIMIT ||= '200M'; // import CSV e upload di backup

	const manifest = JSON.parse(sea.getAsset('manifest.json', 'utf8'));
	env.APP_VERSION ||= manifest.version;

	try {
		fs.mkdirSync(env.DATA_DIR, { recursive: true });
		fs.accessSync(env.DATA_DIR, fs.constants.W_OK);
	} catch (err) {
		return fatal(
			`La cartella ${env.DATA_DIR} non è scrivibile, quindi non può contenere il database. ` +
				'Sposta cunti.exe in una cartella tua (es. Documenti\\Cunti) e riavvialo.',
			err
		);
	}

	const cacheRoot =
		process.platform === 'win32'
			? path.join(env.LOCALAPPDATA || os.tmpdir(), 'Cunti', 'app')
			: path.join(os.tmpdir(), 'cunti-app');
	const appDir = path.join(cacheRoot, manifest.hash);
	if (!fs.existsSync(path.join(appDir, '.complete'))) {
		console.log(`[cunti] prima esecuzione della versione ${manifest.version}: preparo i file…`);
		try {
			extract(manifest, cacheRoot, appDir);
		} catch (err) {
			return fatal(`Estrazione dei file in ${cacheRoot} non riuscita.`, err);
		}
	}

	const appRequire = createRequire(path.join(appDir, 'boot.cjs'));
	const boot = appRequire('./boot.cjs');
	boot(pathToFileURL(path.join(appDir, 'build', 'index.js')).href).then(
		() => whenReady(manifest),
		(err) => fatal('Avvio del server non riuscito.', err)
	);
}

main();
