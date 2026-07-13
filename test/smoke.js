// test/smoke.js – Smoke-Test für Parser, Indexer und Tool-Aufrufe
// Läuft in der Sandbox: node test/smoke.js (aus D:\Nexus)
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { parseNote } from '../src/parse.js';
import { buildIndexer } from '../src/indexer.js';
import { makeTools } from '../src/tools.js';
import { makeVaultRegistry } from '../src/vault-registry.js';

// ── Farben ────────────────────────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const B = s => `\x1b[34m${s}\x1b[0m`;

let passed = 0, failed = 0;
function assert(label, cond, detail = '') {
  if (cond) { console.log(G('  ✓'), label); passed++; }
  else       { console.log(R('  ✗'), label, detail ? R(`(${detail})`) : ''); failed++; }
}

// ── Temp-Vault anlegen ────────────────────────────────────────────────────────
const tmp   = join('/tmp', `nexus-smoke-${Date.now()}`);
const vault = join(tmp, 'vault');
const dbPath = join(tmp, 'smoke.db');
mkdirSync(vault, { recursive: true });
mkdirSync(join(vault, 'Uni'), { recursive: true });

writeFileSync(join(vault, 'README.md'), `---
title: Startseite
tags: [meta, wichtig]
status: done
---
# Startseite
Willkommen im Nexus-Test-Vault.

## Setup
Hier steht das Setup.

[[Uni/Thermodynamik]] und [[README]]
`);

writeFileSync(join(vault, 'Uni', 'Thermodynamik.md'), `---
title: Thermodynamik
status: todo
priority: high
---
# Thermodynamik
Erster Hauptsatz: dU = deltaQ minus deltaW

## Carnot-Wirkungsgrad
eta = 1 minus T_kalt geteilt T_warm
`);

writeFileSync(join(vault, 'Uni', 'Strömungslehre.md'), `# Strömungslehre
Kontinuitätsgleichung: Massenstrom bleibt erhalten

#strömung #uni
`);

// ═════════════════════════════════════════════════════════════════════════════
console.log(B('\n── 1. parse.js ──────────────────────────────────────────'));
// ═════════════════════════════════════════════════════════════════════════════
const readme = `---
title: Testnotiz
tags: [foo, bar]
---
# Überschrift 1
Text.
## Unterabschnitt
Mehr Text. [[AndereNotiz|Alias]] #extra
`;
const parsed = parseNote(readme);
assert('title aus Frontmatter', parsed.title === 'Testnotiz');
assert('tags aus Frontmatter', parsed.tags.includes('foo') && parsed.tags.includes('bar'));
assert('headings Level 1',     parsed.headings.some(h => h.level === 1 && h.text === 'Überschrift 1'));
assert('headings Level 2',     parsed.headings.some(h => h.level === 2 && h.text === 'Unterabschnitt'));
assert('wikilink mit Alias',   parsed.links.some(l => l.target === 'AndereNotiz' && l.alias === 'Alias'));
assert('inline-tag #extra',    parsed.tags.includes('extra'));

// ═════════════════════════════════════════════════════════════════════════════
console.log(B('\n── 2. Indexer ───────────────────────────────────────────'));
// ═════════════════════════════════════════════════════════════════════════════
const indexer = buildIndexer(vault, dbPath, ['.DS_Store']);
const n = indexer.reindex();
assert('reindex gibt Zahl zurück', typeof n === 'number');
assert('3 Dateien indexiert',      n === 3, `erhalten: ${n}`);

// DB-Direktcheck
const rows = indexer.db.prepare('SELECT path, title FROM notes ORDER BY path').all();
assert('DB: 3 Einträge',           rows.length === 3, `${rows.length}`);
assert('DB: README.md gefunden',   rows.some(r => r.path === 'README.md'));
assert('DB: Titel korrekt',        rows.find(r => r.path === 'README.md')?.title === 'Startseite');
assert('DB: Uni/Thermodynamik.md', rows.some(r => r.path === 'Uni/Thermodynamik.md'));

const links = indexer.db.prepare('SELECT target FROM links').all();
assert('Links: Thermodynamik verlinkt', links.some(l => l.target.includes('Thermodynamik')));

// Schema-Version
const verRow = indexer.db.prepare('PRAGMA user_version').get();
assert('DB schema version = 3', verRow.user_version === 3, `erhalten: ${verRow.user_version}`);

// ═════════════════════════════════════════════════════════════════════════════
console.log(B('\n── 3. tools.js ──────────────────────────────────────────'));
// ═════════════════════════════════════════════════════════════════════════════
const tools = makeTools(indexer, vault);

// search – Grundfunktion
const r1 = tools.search({ q: 'Carnot', limit: 5 });
assert('search "Carnot" findet Thermodynamik', r1.some(x => x.path.includes('Thermodynamik')));
assert('search "Carnot" gibt snippet zurück',  r1.length > 0 && r1[0].snippet !== null);

const r2 = tools.search({ q: 'Kontinuität', limit: 5 });
assert('search "Kontinuität" findet Strömungslehre', r2.some(x => x.path.includes('Strömung')));

const r3 = tools.search({ q: '', limit: 10 });
assert('search ohne q gibt Ergebnisse', r3.length >= 1);

// search – Sonderzeichen dürfen keinen SQL-Fehler werfen (P0-Regression)
let r_special;
try {
  r_special = tools.search({ q: 'Carnot++-"()', limit: 5 });
  assert('search mit FTS5-Sonderzeichen: kein Fehler', Array.isArray(r_special));
  assert('search mit Sonderzeichen findet Thermodynamik', r_special.some(x => x.path.includes('Thermodynamik')));
} catch (e) {
  assert('search mit FTS5-Sonderzeichen: kein Fehler', false, e.message);
  assert('search mit Sonderzeichen findet Thermodynamik', false, 'Exception');
}

// search – leere Eingabe nach Sanitizing
const r_empty = tools.search({ q: '---+++', limit: 5 });
assert('search mit reiner Sonderzeichen-Eingabe gibt leeres Array', Array.isArray(r_empty) && r_empty.length === 0);

// search – Pagination (offset)
const r_pg1 = tools.search({ q: '', limit: 2, offset: 0 });
const r_pg2 = tools.search({ q: '', limit: 2, offset: 2 });
assert('search offset=0 gibt 2 Einträge', r_pg1.length === 2, `${r_pg1.length}`);
assert('search offset=2 gibt <= 2 Einträge', r_pg2.length <= 2);

// listNotes
const all = tools.listNotes({ limit: 10 });
assert('listNotes gibt 3 Einträge', all.length === 3, `${all.length}`);

const uniNotes = tools.listNotes({ prefix: 'Uni/', limit: 10 });
assert('listNotes prefix=Uni/ gibt 2', uniNotes.length === 2, `${uniNotes.length}`);

// listNotes – Pagination
const ln1 = tools.listNotes({ limit: 2, offset: 0 });
const ln2 = tools.listNotes({ limit: 2, offset: 2 });
assert('listNotes offset=0: 2 Einträge', ln1.length === 2, `${ln1.length}`);
assert('listNotes offset=2: 1 Eintrag',  ln2.length === 1, `${ln2.length}`);

// readNote
const rn = tools.readNote({ path: 'Uni/Thermodynamik.md' });
assert('readNote: kein error', !rn.error);
assert('readNote: enthält Carnot', rn.content?.includes('Carnot'));

const rn2 = tools.readNote({ path: 'Uni/Thermodynamik.md', section: 'Carnot', lines: 5 });
assert('readNote section: gibt Abschnitt zurück', rn2.content?.includes('Carnot'));

// outline
const ol = tools.outline({ path: 'README.md' });
assert('outline: hat headings', ol.headings?.length >= 2);

// backlinks
const bl = tools.backlinks({ path: 'Uni/Thermodynamik.md' });
assert('backlinks: README verlinkt Thermodynamik', bl.backlinks?.some(b => b.path === 'README.md'));

// writeNote + reindex
tools.writeNote({ path: 'Neu.md', content: '# Neue Notiz\nTest-Inhalt', create: true });
const r4 = tools.search({ q: 'Test Inhalt', limit: 5 });
assert('writeNote + FTS: neue Notiz findbar', r4.some(x => x.path === 'Neu.md'));

// reindex (via tools)
const ri = tools.reindex();
assert('tools.reindex(): ok=true', ri.ok === true);

// query (Frontmatter-Filter)
const q1 = tools.query({ field: 'status', op: '=', value: 'todo' });
assert('query status=todo findet Thermodynamik', q1.some(x => x.path.includes('Thermodynamik')));
assert('query status=todo findet nicht README',  !q1.some(x => x.path === 'README.md'));

const q2 = tools.query({ field: 'tags', op: 'contains', value: 'meta' });
assert('query tags contains meta findet README', q2.some(x => x.path === 'README.md'));

const q3 = tools.query({ field: 'priority', op: 'exists' });
assert('query priority exists findet Thermodynamik', q3.some(x => x.path.includes('Thermodynamik')));
assert('query priority exists nicht README (kein priority)', !q3.some(x => x.path === 'README.md'));

const q4 = tools.query({ field: 'status', op: '!=', value: 'done' });
assert('query status!=done schließt README aus', !q4.some(x => x.path === 'README.md'));

const qErr = tools.query({ field: 'status', op: 'xyz', value: 'test' });
assert('query mit ungültigem op gibt error', !!qErr.error);

// patch
const patchTarget = 'Uni/Thermodynamik.md';
const p1 = tools.patch({
  path: patchTarget,
  patches: [{ old_str: 'Erster Hauptsatz', new_str: 'Erster Hauptsatz (HS1)' }],
});
assert('patch: ok=true',    p1.ok === true,  JSON.stringify(p1));
assert('patch: applied=1',  p1.applied === 1, `applied=${p1.applied}`);
const patchedContent = tools.readNote({ path: patchTarget });
assert('patch: Text wurde ersetzt', patchedContent.content?.includes('Erster Hauptsatz (HS1)'));

const p2 = tools.patch({
  path: patchTarget,
  patches: [
    { old_str: '(HS1)', new_str: '(Thermodynamik)' },
    { old_str: 'Carnot-Wirkungsgrad', new_str: 'Carnot-Wirkungsgrad (eta)' },
  ],
});
assert('patch: mehrere Patches, applied=2', p2.applied === 2, `applied=${p2.applied}`);

const p3 = tools.patch({
  path: patchTarget,
  patches: [{ old_str: 'EXISTIERT_NICHT_XYZ', new_str: 'irrelevant' }],
});
assert('patch: unbekannter old_str gibt error', !!p3.error);
assert('patch: missed enthält old_str',         p3.missed?.some(m => m.includes('EXISTIERT_NICHT')));

// ═════════════════════════════════════════════════════════════════════════════
console.log(B('\n── 3a. R14: Schreib-Integrität (keine stille Trunkierung) ────'));
// ═════════════════════════════════════════════════════════════════════════════
// Große, emoji-/umlautreiche Notiz schreiben -> Byte-Gleichheit auf der Platte.
// (Emojis/Umlaute zählen mehrere UTF-8-Bytes – deckt das "früher gekappt"-Symptom ab.)
let bigContent = '# Große Notiz 🎓\n\n';
for (let i = 0; i < 1500; i++) {
  bigContent += `## Abschnitt ${i} 🔧✅ – Ümläute & Sönderzeichen\nZeile mit Inhalt Nummer ${i}, lorem ipsum dolor sit amet.\n\n`;
}
const expectedBigBytes = Buffer.byteLength(bigContent, 'utf8');
assert('R14: Test-Notiz ist > 50 KB', expectedBigBytes > 50_000, `${expectedBigBytes} Bytes`);

const wBig = tools.writeNote({ path: 'R14-Big.md', content: bigContent, create: true });
assert('R14: writeNote ok=true', wBig.ok === true, JSON.stringify(wBig).slice(0, 120));
assert('R14: writeNote meldet geschriebene Bytes', wBig.bytes === expectedBigBytes, `bytes=${wBig.bytes}`);
const bigOnDisk = readFileSync(join(vault, 'R14-Big.md'), 'utf8');
const bigDiskBytes = statSync(join(vault, 'R14-Big.md')).size;
assert('R14: Datei byte-gleich auf Platte', bigDiskBytes === expectedBigBytes, `disk=${bigDiskBytes}`);
assert('R14: Inhalt vollständig (letzter Abschnitt da)', bigOnDisk.includes('Abschnitt 1499'));
assert('R14: keine NUL-Bytes (kein Padding)', !bigOnDisk.includes(String.fromCharCode(0)));
// R14+: writeNote schreibt atomar (tmp + rename) und prüft per VOLLEM Read-Back gegen das
// Soll – nicht nur Byte-Länge (fängt NUL-Padding/Stale-Write-Back gleicher Länge über den
// Mount). Hier: kein .nexustmp-Sidecar bleibt zurück, Read-Back stimmt exakt.
assert('R14+: kein .nexustmp-Sidecar bleibt liegen', !existsSync(join(vault, 'R14-Big.md.nexustmp')));
assert('R14+: Read-Back exakt gleich dem Soll', bigOnDisk === bigContent);

// append_to_section auf die große Notiz -> bestehender Inhalt bleibt erhalten + neuer Text dran
const aBig = tools.appendToSection({ path: 'R14-Big.md', section: 'Abschnitt 7 ', text: 'R14-ANGEHÄNGT 🚀' });
assert('R14: append ok=true', aBig.ok === true, JSON.stringify(aBig).slice(0, 120));
const afterAppend = readFileSync(join(vault, 'R14-Big.md'), 'utf8');
assert('R14: append erhält Original (Abschnitt 1499 noch da)', afterAppend.includes('Abschnitt 1499'));
assert('R14: append fügt neuen Text ein', afterAppend.includes('R14-ANGEHÄNGT'));
assert('R14: append wird nie kürzer als Original', Buffer.byteLength(afterAppend, 'utf8') >= expectedBigBytes);

// patch auf die große Notiz -> Längen-Invariante hält, Rest bleibt erhalten
const beforePatchLen = readFileSync(join(vault, 'R14-Big.md'), 'utf8').length;
const pBig = tools.patch({ path: 'R14-Big.md', patches: [{ old_str: 'Abschnitt 0 ', new_str: 'Abschnitt NULL ' }] });
assert('R14: patch ok=true', pBig.ok === true, JSON.stringify(pBig).slice(0, 120));
const afterPatch = readFileSync(join(vault, 'R14-Big.md'), 'utf8');
assert('R14: patch erhält Original (Abschnitt 1499 noch da)', afterPatch.includes('Abschnitt 1499'));
assert('R14: patch Längen-Invariante (+3 Zeichen)', afterPatch.length === beforePatchLen + 3, `${afterPatch.length} vs ${beforePatchLen + 3}`);

// Aufräumen: R14-Big.md wieder entfernen, damit der DB-Stand für den deleteFile-Test stimmt.
tools.delete({ path: 'R14-Big.md' });

// deleteFile (für File-Watcher)
const delPath = join(vault, 'Uni', 'Strömungslehre.md');
indexer.deleteFile(delPath);
// Nach writeNote (Neu.md) haben wir 4 Einträge; nach deleteFile wieder 3
const afterDel = indexer.db.prepare('SELECT COUNT(*) as n FROM notes').get();
assert('deleteFile entfernt Eintrag aus DB', afterDel.n === 3, `n=${afterDel.n}`);

// ═════════════════════════════════════════════════════════════════════════════
console.log(B('\n── 3b. Ordner-/Datei-Operationen (create_folder/move/delete) ─'));

// create_folder
const cf = tools.createFolder({ path: 'Projekte/Unterordner' });
assert('create_folder: ok',            cf.ok === true, JSON.stringify(cf));
assert('create_folder: Ordner da',     existsSync(join(vault, 'Projekte', 'Unterordner')));
assert('create_folder: doppelt -> error', !!tools.createFolder({ path: 'Projekte/Unterordner' }).error);
assert('create_folder: ../-Ausbruch -> error', !!tools.createFolder({ path: '../boom' }).error);

// move (umbenennen + verschieben)
tools.writeNote({ path: 'VerschiebMich.md', content: '# Tmp\nInhalt', create: true });
const mv = tools.move({ from: 'VerschiebMich.md', to: 'Projekte/Unterordner/Verschoben.md' });
assert('move: ok',                 mv.ok === true, JSON.stringify(mv));
assert('move: Ziel existiert',     existsSync(join(vault, 'Projekte', 'Unterordner', 'Verschoben.md')));
assert('move: Quelle weg',         !existsSync(join(vault, 'VerschiebMich.md')));
assert('move: fehlende Quelle -> error', !!tools.move({ from: 'GibtsNicht.md', to: 'X.md' }).error);

// delete (ganzer Ordner rekursiv)
const dl = tools.delete({ path: 'Projekte' });
assert('delete: ok',               dl.ok === true, JSON.stringify(dl));
assert('delete: Ordner weg',       !existsSync(join(vault, 'Projekte')));
assert('delete: Vault-Wurzel -> error', !!tools.delete({ path: '' }).error);

// ═════════════════════════════════════════════════════════════════════════════
console.log(B('\n── 4. /api/reindex (HTTP) ───────────────────────────────'));
console.log('   Übersprungen – läuft nur wenn ui-server.js aktiv (Port 3000)');
console.log('   Test: curl -s -X POST http://localhost:3000/api/reindex \\');
console.log('         -H "Content-Type: application/json" \\');
console.log('         -d \'{"vault":"knowledge-base"}\'');
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
console.log(B('\n── 5. vault-registry (Multi-Vault + Live-Config) ────────'));
// ═════════════════════════════════════════════════════════════════════════════
const regDir = join(tmp, 'registry');
const vA = join(regDir, 'vault-a'), vB = join(regDir, 'vault-b'), vC = join(regDir, 'vault-c');
mkdirSync(vA, { recursive: true });
mkdirSync(vB, { recursive: true });
writeFileSync(join(vA, 'A-Notiz.md'), '# A-Notiz\nInhalt Alpha\n');
writeFileSync(join(vB, 'B-Notiz.md'), '# B-Notiz\nInhalt Beta\n');

const regCfgPath = join(regDir, 'nexus.config.json');
const writeCfg = c => writeFileSync(regCfgPath, JSON.stringify(c, null, 2));
const vaultA = { name: 'a', path: vA, dbPath: join(regDir, 'a.db') };
const vaultB = { name: 'b', path: vB, dbPath: join(regDir, 'b.db') };
const vaultC = { name: 'c', path: vC, dbPath: join(regDir, 'c.db') };
writeCfg({ activeVault: 'a', vaults: [vaultA, vaultB], ignore: [] });

const registry = makeVaultRegistry({
  configPath:    regCfgPath,
  loadConfig:    () => JSON.parse(readFileSync(regCfgPath, 'utf8')),
  resolveDbPath: v => v.dbPath,
  buildIndexer,
  makeTools,
});

assert('registry: beide Vaults registriert',   registry.size() === 2);
assert('registry: Default = activeVault (a)',  registry.get().vault.name === 'a');
assert('registry: get("b") liefert Vault b',   registry.get('b').vault.name === 'b');
assert('registry: liest im richtigen Vault',   !!registry.get('b').tools.readNote({ path: 'B-Notiz.md' }).content?.includes('Beta'));
assert('registry: Vaults sind isoliert',       !!registry.get('a').tools.readNote({ path: 'B-Notiz.md' }).error);
let unknownErr = '';
try { registry.get('gibtsnicht'); } catch (e) { unknownErr = e.message; }
assert('registry: unbekannter Vault -> Fehler mit Liste', unknownErr.includes('Vault nicht gefunden') && unknownErr.includes('a, b'));

// Hot-Add: Vault c entsteht auf Platte + in der Config, während die Registry läuft
mkdirSync(vC, { recursive: true });
writeFileSync(join(vC, 'C-Notiz.md'), '# C-Notiz\nInhalt Gamma\n');
writeCfg({ activeVault: 'a', vaults: [vaultA, vaultB, vaultC], ignore: [] });
assert('registry: neuer Vault ohne Neustart erreichbar', !!registry.get('c').tools.readNote({ path: 'C-Notiz.md' }).content?.includes('Gamma'));
assert('registry: size nach Hot-Add = 3', registry.size() === 3);

// list(): Namen, active-Flag, Notiz-Zähler
const rl = registry.list();
assert('registry: list() kennt alle drei',   rl.vaults.map(v => v.name).sort().join(',') === 'a,b,c');
assert('registry: list() markiert aktiven',  rl.vaults.find(v => v.name === 'a')?.active === true && rl.activeVault === 'a');
assert('registry: list() zählt Notizen',     rl.vaults.find(v => v.name === 'c')?.notes === 1);

// Hot-Remove: b verschwindet aus der Config -> abgemeldet
writeCfg({ activeVault: 'a', vaults: [vaultA, vaultC], ignore: [] });
let removedErr = '';
try { registry.get('b'); } catch (e) { removedErr = e.message; }
assert('registry: entfernter Vault abgemeldet', removedErr.includes('Vault nicht gefunden') && registry.size() === 2);

// activeVault-Wechsel in der App -> Default folgt live. _touch ändert die Dateigröße,
// damit der Test nicht von der mtime-Auflösung des Dateisystems abhängt (die echte
// App schreibt nie zweimal in derselben Millisekunde).
writeCfg({ activeVault: 'c', vaults: [vaultA, vaultC], ignore: [], _touch: 'aktiv-wechsel' });
assert('registry: Default folgt activeVault-Wechsel', registry.get().vault.name === 'c');
registry.close(); // DB-Handles freigeben, damit das Aufräumen unten durchläuft

// ── Aufräumen ─────────────────────────────────────────────────────────────────
// Unter Windows hält das offene SQLite-WAL-Handle die DB-Datei kurz fest -> rmSync
// kann mit EPERM/EBUSY scheitern. maxRetries/retryDelay fängt das ab; schlägt es
// trotzdem fehl, ist das nur ein Teardown-Artefakt (Temp-Ordner) und darf den
// Testlauf NICHT rot färben (alle Asserts sind dann bereits gelaufen).
try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); }
catch (e) { console.log(B(`  (Hinweis: Temp-Ordner nicht entfernt – ${e.code || e.message})`)); }

// ── Ergebnis ──────────────────────────────────────────────────────────────────
const failStr = failed > 0 ? '  ' + R(failed + ' fehlgeschlagen') : '';
console.log('\n' + G(passed + ' bestanden') + failStr);
if (failed > 0) process.exit(1);
