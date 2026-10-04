// Crea l'eseguibile unico di Cunti (Node.js Single Executable Application) per la
// piattaforma su cui gira: dist/cunti.exe su Windows, dist/cunti altrove.
//
//   npm run build && npm run build:exe
//
// Va lanciato con un binario node ufficiale (quello di nodejs.org o di actions/setup-node):
// la copia di quel binario diventa l'eseguibile, e il modulo nativo di better-sqlite3 in
// node_modules deve essere compilato per la stessa versione. In CI gira su windows-latest.
// La versione mostrata dall'app si passa con APP_VERSION (default "dev").
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { inject } from 'postject';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage'); // file generati da includere
const version = process.env.APP_VERSION?.trim() || 'dev';
const isWin = process.platform === 'win32';
const exe = path.join(DIST, isWin ? 'cunti.exe' : 'cunti');

if (!fs.existsSync(path.join(ROOT, 'build', 'index.js'))) {
	console.error('Manca build/: lancia prima `npm run build`.');
	process.exit(1);
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

/** Tutti i file sotto `dir` (percorsi relativi con "/"), filtrati. */
function walk(dir, keep = () => true, base = dir) {
	const out = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(full, keep, base));
		else if (keep(full)) out.push(path.relative(base, full).split(path.sep).join('/'));
	}
	return out;
}

// asset: chiave (percorso nella cartella estratta) → file sorgente
const assets = {};
const add = (key, source) => (assets[key] = source);

// server compilato da adapter-node, senza source map
for (const rel of walk(path.join(ROOT, 'build'), (f) => !f.endsWith('.map'))) add(`build/${rel}`, path.join(ROOT, 'build', rel));

// unica dipendenza esterna del server: better-sqlite3 (JS + modulo nativo) e ciò che
// usa per trovare il modulo nativo a runtime
const nm = (p) => path.join(ROOT, 'node_modules', p);
add('node_modules/better-sqlite3/package.json', nm('better-sqlite3/package.json'));
for (const rel of walk(nm('better-sqlite3/lib'))) add(`node_modules/better-sqlite3/lib/${rel}`, nm(`better-sqlite3/lib/${rel}`));
add('node_modules/better-sqlite3/build/Release/better_sqlite3.node', nm('better-sqlite3/build/Release/better_sqlite3.node'));
for (const pkg of ['bindings', 'file-uri-to-path'])
	for (const rel of walk(nm(pkg), (f) => /\.(js|json)$/.test(f) && !/[\\/]test[\\/]/.test(f)))
		add(`node_modules/${pkg}/${rel}`, nm(`${pkg}/${rel}`));

// file generati: package.json perché build/*.js sia ESM, e il ponte CommonJS con cui
// il launcher (che può caricare solo moduli built-in) fa l'import() del server
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(path.join(STAGE, 'boot.cjs'), 'module.exports = (url) => import(url);\n');
add('package.json', path.join(STAGE, 'package.json'));
add('boot.cjs', path.join(STAGE, 'boot.cjs'));

// manifest: elenco dei file e hash del contenuto, che fa da chiave della cache estratta
const files = Object.keys(assets).sort();
const hash = crypto.createHash('sha256').update(version);
for (const f of files) hash.update(f).update(fs.readFileSync(assets[f]));
const manifest = { version, hash: hash.digest('hex').slice(0, 16), files };
fs.writeFileSync(path.join(STAGE, 'manifest.json'), JSON.stringify(manifest));
add('manifest.json', path.join(STAGE, 'manifest.json'));

// blob SEA
const blob = path.join(DIST, 'sea-prep.blob');
const config = {
	main: path.join(ROOT, 'desktop', 'launcher.cjs'),
	output: blob,
	disableExperimentalSEAWarning: true,
	useSnapshot: false,
	useCodeCache: false,
	assets
};
fs.writeFileSync(path.join(DIST, 'sea-config.json'), JSON.stringify(config, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(DIST, 'sea-config.json')], { stdio: 'inherit' });

// eseguibile = copia di node + blob iniettato
fs.copyFileSync(process.execPath, exe);
if (isWin) {
	// la firma di node.exe non vale più dopo l'iniezione: si toglie se c'è signtool
	try {
		execFileSync('signtool', ['remove', '/s', exe], { stdio: 'ignore' });
	} catch {
		console.warn('signtool non disponibile: firma originale lasciata (non valida dopo l\'iniezione).');
	}
}
await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(blob), {
	sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
});
fs.chmodSync(exe, 0o755);

fs.rmSync(STAGE, { recursive: true, force: true });
const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`\n${path.relative(ROOT, exe)} creato (${mb} MB): versione ${version}, ${files.length} file, cache ${manifest.hash}`);
