#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Nexus R22 Phase 0 – CodeMirror 6 lokal vendoren (public/vendor/cm6/)
//
// REZEPT, KEIN BUILD-SCHRITT: laeuft NIE automatisch (nicht bei npm install,
// nicht beim Start, nicht bei npm run dist). Nur von Hand. CLAUDE.md-Regel 3
// bleibt gewahrt – im Repo liegen nur fertige Dateien, kein Bundler.
//
// Muster wie fflate (R21b): npm-Tarball holen, sha512 gegen die Registry pruefen,
// nur die gebrauchte ESM-Datei nach public/vendor/cm6/ kopieren – BYTE-IDENTISCH,
// ohne Bundler und ohne Patch. Kein npm-Dependency, package.json bleibt unberuehrt.
//
//   node scripts/fetch-cm6.mjs            # Dateien neu holen + MANIFEST.tsv schreiben
//   node scripts/fetch-cm6.mjs --verify   # nur pruefen: Platte == Registry? (Exit 1 = Abweichung)
//
// Warum diese 11 Pakete und nicht @codemirror/lang-markdown:
//   Der Lezer-Baum (Token-Quelle fuer R22 Phase 1) kommt aus @lezer/markdown.
//   @codemirror/lang-markdown wrappt ihn nur, zieht dafuer aber ueber einen statischen
//   Top-Level-Import die ganze lang-html-Kette nach (+367 kB: lang-html, lang-css,
//   lang-javascript, autocomplete, lezer-html/css/javascript/lr) – nur fuer
//   HTML-in-Markdown-Subparsing und HTML-Tag-Autocomplete. Beides braucht Nexus nicht.
//   Preis: markdownKeymap (Enter setzt Listen fort) fehlt – das kann CM5 heute aber
//   auch nicht (die App laedt das CM5-Addon nicht), Paritaet bleibt also gewahrt.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, '..', 'public', 'vendor', 'cm6');

// Exakt gepinnt. Ein Update heisst: Version hier hochziehen, Skript laufen lassen,
// MANIFEST.tsv-Diff im Commit pruefen, Editor live gegentesten.
const PKGS = [
  ['@codemirror/state', '6.7.1'],
  ['@codemirror/view', '6.43.6'],
  ['@codemirror/language', '6.12.4'],
  ['@codemirror/commands', '6.10.4'],
  ['@lezer/markdown', '1.7.2'],
  ['@lezer/common', '1.5.2'],
  ['@lezer/highlight', '1.2.3'],
  ['@marijn/find-cluster-break', '1.0.3'],
  ['crelt', '1.0.7'],
  ['style-mod', '4.1.3'],
  ['w3c-keyname', '2.2.8'],
];

const VERIFY = process.argv.includes('--verify');
const flat = (n) => n.replace(/^@/, '').replace(/\//g, '-') + '.js';
// shell:true auf Windows, weil Node >=22 spawnSync auf .cmd sonst mit EINVAL abbricht.
// Unbedenklich: spec/field sind Konstanten aus PKGS, keine Fremdeingabe.
const npmView = (spec, field) =>
  execFileSync('npm', ['view', spec, field], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();

function die(msg) { console.error('[fetch-cm6] ABBRUCH: ' + msg); process.exit(1); }

const rows = [];
let bad = 0;

for (const [name, ver] of PKGS) {
  const spec = `${name}@${ver}`;
  const integrity = npmView(spec, 'dist.integrity');
  const tarball = npmView(spec, 'dist.tarball');
  if (!integrity.startsWith('sha512-')) die(`${spec}: Registry liefert kein sha512 (${integrity})`);

  const tmp = mkdtempSync(join(tmpdir(), 'cm6-'));
  execFileSync('curl', ['-sSL', '-o', join(tmp, 'p.tgz'), tarball]);
  const tgz = readFileSync(join(tmp, 'p.tgz'));

  // (1) Tarball gegen die Registry pruefen – das ist die Herkunfts-Kette.
  const mine = 'sha512-' + createHash('sha512').update(tgz).digest('base64');
  if (mine !== integrity) die(`${spec}: sha512 weicht ab!\n  Registry: ${integrity}\n  geladen : ${mine}`);

  // tar mit cwd + relativem Namen: GNU-tar unter Git Bash deutet "C:\..." sonst als Remote-Host.
  execFileSync('tar', ['-xzf', 'p.tgz'], { cwd: tmp });

  // (2) FALLE: package.json "main" zeigt bei crelt/w3c-keyname/style-mod auf CommonJS (.cjs).
  //     Immer die import-Bedingung aus "exports" nehmen, sonst vendort man CJS, das der
  //     Browser nicht als Modul laedt. Zwei Schreibweisen kommen im Graphen VOR:
  //       Subpath-Form  {".": {"import": "./dist/index.js"}}   – @codemirror/*, @lezer/*
  //       Kurzform      {"import": "./index.js"}               – crelt, style-mod,
  //                                                              w3c-keyname, @marijn/*
  //     Nur "module" ist ein sicherer Notnagel; "main" NIE (waere CJS).
  const pj = JSON.parse(readFileSync(join(tmp, 'package', 'package.json'), 'utf8'));
  const ex = pj.exports;
  let rel = ex?.['.']?.import ?? ex?.['.']?.default ?? ex?.import ?? ex?.default ?? pj.module;
  if (typeof rel === 'object') rel = rel.default ?? rel.import;
  if (!rel) die(`${spec}: keine ESM-Datei in exports gefunden (exports=${JSON.stringify(ex)})`);
  rel = String(rel).replace(/^\.\//, '');
  if (/\.cjs$/.test(rel)) die(`${spec}: aufgeloester Pfad ${rel} ist CommonJS – im Browser nicht ladbar`);

  const bytes = readFileSync(join(tmp, 'package', rel));
  const dest = join(OUT, flat(name));
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  if (VERIFY) {
    if (!existsSync(dest)) { console.error(`  FEHLT   ${flat(name)}`); bad++; }
    else if (createHash('sha256').update(readFileSync(dest)).digest('hex') !== sha256) {
      console.error(`  ABWEICHUNG ${flat(name)} – Datei auf der Platte != npm-Tarball`); bad++;
    } else console.log(`  OK      ${flat(name).padEnd(30)} ${String(bytes.length).padStart(7)} B`);
  } else {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(dest, bytes);
    console.log(`  geholt  ${flat(name).padEnd(30)} ${String(bytes.length).padStart(7)} B  ${rel}`);
  }
  rows.push({ file: flat(name), name, ver, rel, bytes: bytes.length, license: pj.license, integrity });
}

if (VERIFY) {
  // Zusaetzlich: liegt eine Datei da, die NICHT ins Manifest gehoert? (sha-Listen sind dafuer blind.)
  const soll = new Set([...rows.map(r => r.file), 'LICENSE', 'MANIFEST.tsv']);
  for (const f of readdirSync(OUT)) {
    if (!soll.has(f)) { console.error(`  UNBEKANNT  ${f} – nicht im Manifest, gehoert hier nicht her`); bad++; }
  }
  console.log(bad ? `\n[fetch-cm6] ${bad} Problem(e).` : `\n[fetch-cm6] OK – alle ${rows.length} Dateien byte-identisch zum npm-Tarball, keine Fremddateien.`);
  process.exit(bad ? 1 : 0);
}

let tsv = '# Nexus R22 Phase 0 - CodeMirror 6, lokal gevendort (Import-Map, kein Bundler)\r\n';
tsv += '# Jede Datei ist eine unveraenderte Kopie aus dem npm-Tarball des Pakets.\r\n';
tsv += '# Nachpruefen: node scripts/fetch-cm6.mjs --verify   (rechnet gegen die Registry)\r\n#\r\n';
tsv += 'datei\tpaket\tversion\tesm_pfad_im_tarball\tbytes\tlizenz\ttarball_sha512\r\n';
for (const r of rows) tsv += [r.file, r.name, r.ver, r.rel, r.bytes, r.license, r.integrity].join('\t') + '\r\n';
writeFileSync(join(OUT, 'MANIFEST.tsv'), tsv);
console.log(`\n[fetch-cm6] ${rows.length} Dateien, ${rows.reduce((a, r) => a + r.bytes, 0).toLocaleString('de-DE')} B – alle sha512 gegen die Registry geprueft.`);
console.log('[fetch-cm6] MANIFEST.tsv geschrieben. LICENSE wird NICHT ueberschrieben (von Hand gepflegt).');
