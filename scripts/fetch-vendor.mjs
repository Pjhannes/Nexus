#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Nexus R27c – DOMPurify, KaTeX und Mermaid lokal vendoren (public/vendor/<paket>/)
//
// REZEPT, KEIN BUILD-SCHRITT (Muster: scripts/fetch-cm6.mjs): laeuft NIE automatisch,
// nur von Hand. Im Repo liegen fertige Dateien, kein Bundler, kein npm-Dependency.
//
//   node scripts/fetch-vendor.mjs            # Dateien neu holen + MANIFEST.tsv/LICENSE je Ordner
//   node scripts/fetch-vendor.mjs --verify   # nur pruefen: Platte == Registry-Tarball? (Exit 1 = Abweichung)
//
// Warum lokal: (1) Offline-Faehigkeit – eine Formel-/Diagramm-Notiz rendert ohne Internet,
// (2) Content-Security-Policy ohne CDN-Hosts (src/csp.js, tauri.conf.json): script-src 'self'.
// KaTeX: nur die woff2-Fonts – katex.min.css listet woff2 zuerst, WebView2/Chromium/Safari
// laden dann weder .woff noch .ttf. Mermaid: dist/mermaid.min.js ist ein in sich geschlossenes
// IIFE-Bundle (keine dynamischen import()-Chunks, geprueft beim Vendoring).
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const VENDOR = join(__dir, '..', 'public', 'vendor');

// Exakt gepinnt. Update = Version hier hochziehen, Skript laufen lassen, MANIFEST-Diff pruefen,
// Formel-/Mermaid-Notiz + HTML-Notiz (Sanitizer) live gegentesten.
const PKGS = [
  { name: 'dompurify', ver: '3.4.15', dir: 'dompurify',
    files: [['dist/purify.min.js', 'purify.min.js']], licenses: ['LICENSE', 'LICENSE-MPL'] },
  { name: 'katex', ver: '0.16.47', dir: 'katex',
    files: [['dist/katex.min.js', 'katex.min.js'], ['dist/katex.min.css', 'katex.min.css']],
    glob: { from: 'dist/fonts', to: 'fonts', match: /\.woff2$/ }, licenses: ['LICENSE'] },
  { name: 'mermaid', ver: '11.17.2', dir: 'mermaid',
    files: [['dist/mermaid.min.js', 'mermaid.min.js']], licenses: ['LICENSE'],
    check: (bytes) => { if (/\bimport\s*\(/.test(bytes.toString('latin1'))) throw new Error('mermaid.min.js enthaelt dynamische import()-Aufrufe – Chunks muessten mit vendort werden'); } },
];

const VERIFY = process.argv.includes('--verify');
const npmView = (spec, field) =>
  execFileSync('npm', ['view', spec, field], { encoding: 'utf8', shell: process.platform === 'win32' }).trim();
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
function die(msg) { console.error('[fetch-vendor] ABBRUCH: ' + msg); process.exit(1); }

let bad = 0, total = 0;
for (const p of PKGS) {
  const spec = `${p.name}@${p.ver}`;
  const integrity = npmView(spec, 'dist.integrity');
  const tarball = npmView(spec, 'dist.tarball');
  if (!integrity.startsWith('sha512-')) die(`${spec}: Registry liefert kein sha512 (${integrity})`);

  const tmp = mkdtempSync(join(tmpdir(), 'nexus-vendor-'));
  execFileSync('curl', ['-sSL', '-o', join(tmp, 'p.tgz'), tarball]);
  const tgz = readFileSync(join(tmp, 'p.tgz'));
  const mine = 'sha512-' + createHash('sha512').update(tgz).digest('base64');
  if (mine !== integrity) die(`${spec}: sha512 weicht ab!\n  Registry: ${integrity}\n  geladen : ${mine}`);
  execFileSync('tar', ['-xzf', 'p.tgz'], { cwd: tmp });
  const pkgRoot = join(tmp, 'package');
  const pj = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));

  const list = [...p.files];
  if (p.glob) {
    for (const f of readdirSync(join(pkgRoot, p.glob.from)).sort()) {
      if (p.glob.match.test(f)) list.push([posix.join(p.glob.from, f), posix.join(p.glob.to, f)]);
    }
  }
  const out = join(VENDOR, p.dir);
  const rows = [];
  console.log(`\n${spec}  (${pj.license})`);
  for (const [src, dst] of list) {
    const bytes = readFileSync(join(pkgRoot, src));
    if (p.check) p.check(bytes);
    const dest = join(out, dst);
    const h = sha256(bytes);
    if (VERIFY) {
      if (!existsSync(dest)) { console.error(`  FEHLT      ${dst}`); bad++; }
      else if (sha256(readFileSync(dest)) !== h) { console.error(`  ABWEICHUNG ${dst} – Datei auf der Platte != npm-Tarball`); bad++; }
      else console.log(`  OK      ${dst.padEnd(40)} ${String(bytes.length).padStart(8)} B`);
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
      console.log(`  geholt  ${dst.padEnd(40)} ${String(bytes.length).padStart(8)} B  ${src}`);
    }
    rows.push({ file: dst, src, bytes: bytes.length, sha256: h });
    total++;
  }
  // LICENSE-Dateien 1:1 aus dem Tarball (Pflicht bei MIT/Apache/MPL: Lizenztext muss mitgeliefert werden)
  for (const lic of p.licenses) {
    const bytes = readFileSync(join(pkgRoot, lic));
    const dest = join(out, lic);
    if (VERIFY) {
      if (!existsSync(dest) || sha256(readFileSync(dest)) !== sha256(bytes)) { console.error(`  ABWEICHUNG ${lic}`); bad++; }
      else console.log(`  OK      ${lic}`);
    } else { mkdirSync(out, { recursive: true }); writeFileSync(dest, bytes); console.log(`  geholt  ${lic}`); }
  }
  if (VERIFY) {
    // Fremddateien im Vendor-Ordner? (sha-Listen sind dafuer blind)
    const soll = new Set([...rows.map(r => r.file.replace(/\//g, '/')), ...p.licenses, 'MANIFEST.tsv']);
    const walk = (d, rel) => { for (const f of readdirSync(d)) { const full = join(d, f); const r = rel ? posix.join(rel, f) : f;
      if (statSync(full).isDirectory()) walk(full, r); else if (!soll.has(r)) { console.error(`  UNBEKANNT  ${r} – nicht im Manifest`); bad++; } } };
    if (existsSync(out)) walk(out, '');
  } else {
    let tsv = `# Nexus R27c - ${p.name} ${p.ver}, lokal gevendort (kein Bundler, kein npm-Dependency)\r\n`;
    tsv += '# Jede Datei ist eine unveraenderte Kopie aus dem npm-Tarball des Pakets.\r\n';
    tsv += '# Nachpruefen: node scripts/fetch-vendor.mjs --verify   (rechnet gegen die Registry)\r\n';
    tsv += `# paket\t${p.name}\tversion\t${p.ver}\tlizenz\t${pj.license}\ttarball_sha512\t${integrity}\r\n#\r\n`;
    tsv += 'datei\tpfad_im_tarball\tbytes\tsha256\r\n';
    for (const r of rows) tsv += [r.file, r.src, r.bytes, r.sha256].join('\t') + '\r\n';
    writeFileSync(join(out, 'MANIFEST.tsv'), tsv);
  }
  rmSync(tmp, { recursive: true, force: true });
}

if (VERIFY) {
  console.log(bad ? `\n[fetch-vendor] ${bad} Problem(e).` : `\n[fetch-vendor] OK – alle ${total} Dateien byte-identisch zum npm-Tarball, keine Fremddateien.`);
  process.exit(bad ? 1 : 0);
}
console.log(`\n[fetch-vendor] ${total} Dateien geholt, MANIFEST.tsv + LICENSE je Ordner geschrieben.`);
