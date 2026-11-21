// test/capture.test.mjs – R31/5: capture legt schnelle Notizen im Eingangsordner ab.
//   A. captureName: Dateiname aus dem Titel
//   B. tools.capture: neue Datei je Aufruf, nie ueberschreiben, Ordner konfigurierbar
//   C. MCP-Pfad (buildServer, InMemoryTransport) inkl. capture.folder aus der Config
// Alles im Temp-Scratch. Lauf: node test/capture.test.mjs
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildIndexer } from '../src/indexer.js';
import { makeTools, captureName, CAPTURE_MAX_ZEICHEN } from '../src/tools.js';
import { buildServer } from '../src/mcp/build-server.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? `\n     Kontext: ${JSON.stringify(extra).slice(0, 500)}` : ''); fail++; }
}

const scratch = mkdtempSync(join(tmpdir(), 'nexus-capture-test-'));
const vaultDir = join(scratch, 'vault');
mkdirSync(vaultDir, { recursive: true });
const indexer = buildIndexer(vaultDir, join(scratch, 'capture.db'), []);
const tools = makeTools(indexer, vaultDir);
const platte = (rel) => readFileSync(join(vaultDir, rel), 'utf8');
const JETZT = new Date(2026, 10, 21, 15, 7, 30);   // 21.11.2026 15:07 Ortszeit

let client = null;
try {
  console.log('\n── A. captureName ──');
  ok('normaler Titel bleibt', captureName('Idee zum Radar') === 'Idee zum Radar');
  ok('verbotene Zeichen werden zu Leerzeichen, Leerraum zusammengefasst', captureName('a/b\\c:d*e?f"g<h>i|j') === 'a b c d e f g h i j');
  ok('Wikilink-Zeichen # ^ [ ] fallen weg', captureName('[[Link]] #tag ^block') === 'Link tag block');
  ok('keine Punkte/Leerzeichen am Rand', captureName('  ..Titel.. ') === 'Titel');
  ok('hoechstens 60 Zeichen, kein Leerzeichen am Ende', captureName('x'.repeat(59) + ' yz').length <= 60 && !/ $/.test(captureName('x'.repeat(59) + ' yz')));
  ok('leer oder nur Sonderzeichen -> "Notiz"', captureName('') === 'Notiz' && captureName('///') === 'Notiz' && captureName(undefined) === 'Notiz');
  ok('Umlaute und Gedankenstrich bleiben', captureName('Prüfung – Übung') === 'Prüfung – Übung');
  ok('NFD-Titel (Buchstabe + Kombinationszeichen) -> NFC-Name', captureName('Übung zur Prüfung') === 'Übung zur Prüfung' && captureName('Café') === 'Café');
  ok('Kuerzung trennt kein Kombinationszeichen ab', captureName('x'.repeat(59) + 'ü') === 'x'.repeat(59) + 'ü');

  console.log('\n── B. tools.capture ──');
  const a = tools.capture({ text: 'Radar: Filter fuer Schicht pruefen\nzweite Zeile', now: JETZT });
  ok('legt "_Eingang/JJJJ-MM-TT HHMM – <erste Zeile>.md" an', a.ok === true && a.path === '_Eingang/2026-11-21 1507 – Radar Filter fuer Schicht pruefen.md', a);
  const inhalt = platte(a.path);
  ok('Frontmatter: typ eingang, erstellt, tags', inhalt.startsWith('---\ntyp: eingang\nerstellt: 2026-11-21T15:07\ntags: [eingang]\n---\n'), inhalt);
  ok('Ueberschrift = erste Zeile (unveraendert), danach der ganze Text', inhalt.includes('\n# Radar: Filter fuer Schicht pruefen\n\nRadar: Filter fuer Schicht pruefen\nzweite Zeile\n'), inhalt);
  ok('Ergebnis nennt Hash, hashVorher null', /^sha256:/.test(a.hash) && a.hashVorher === null);
  ok('sofort im Index', tools.search({ q: 'Schicht' }).some(r => r.path === a.path));
  const b = tools.capture({ text: 'Radar: Filter fuer Schicht pruefen', now: JETZT });
  ok('gleicher Titel in derselben Minute: neue Datei mit (2), nichts ueberschrieben', b.ok && b.path.endsWith(' (2).md') && platte(a.path) === inhalt, b);
  const c = tools.capture({ text: 'Langer Text\nmehr', titel: 'Eigener Titel', now: JETZT });
  ok('titel hat Vorrang vor der ersten Zeile', c.path === '_Eingang/2026-11-21 1507 – Eigener Titel.md' && platte(c.path).includes('# Eigener Titel\n\nLanger Text\nmehr\n'), c);
  const d = tools.capture({ text: '## Schon eine Ueberschrift\nText', now: JETZT });
  ok('fuehrende # der ersten Zeile landen nicht im Titel', d.path.endsWith('– Schon eine Ueberschrift.md') && platte(d.path).includes('\n# Schon eine Ueberschrift\n'), d);
  const e = tools.capture({ text: 'a\r\nb\r\n', now: JETZT });
  ok('CRLF im Text wird zu LF', e.ok && !platte(e.path).includes('\r'));
  ok('leerer Text -> Fehler', typeof tools.capture({ text: '   ' }).error === 'string' && typeof tools.capture({}).error === 'string');
  ok('zu langer Text -> Fehler mit Verweis auf write_note', /write_note/.test(tools.capture({ text: 'x'.repeat(CAPTURE_MAX_ZEICHEN + 1) }).error ?? ''));
  const f = tools.capture({ text: 'anderswo', ordner: 'Inbox/Handy', now: JETZT });
  ok('eigener Ordner (auch verschachtelt) wird angelegt', f.ok && f.path === 'Inbox/Handy/2026-11-21 1507 – anderswo.md' && existsSync(join(vaultDir, f.path)), f);
  for (const o of ['../raus', '/abs', '.trash', '.trash/x', 'C:\\x'])
    ok(`Ordner ${JSON.stringify(o)} -> Fehler`, typeof tools.capture({ text: 'x', ordner: o, now: JETZT }).error === 'string');
  ok('ausserhalb des Vaults ist nichts entstanden', readdirSync(scratch).sort().join() === readdirSync(scratch).filter(n => n === 'vault' || n.startsWith('capture.db')).sort().join(), readdirSync(scratch));

  console.log('\n── C. MCP-Pfad ──');
  let cfg = {};
  const registry = {
    get: () => ({ vault: { name: 'test', path: vaultDir }, tools, indexer }),
    list: () => ({ activeVault: 'test', vaults: [{ name: 'test', path: vaultDir, active: true, notes: 0 }] }),
    config: () => cfg, entries: () => [], refresh: () => {}, size: () => 1,
  };
  const server = buildServer({ registry, info: { version: '0.0.0' } });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: 'capture-test', version: '0.0.0' });
  await client.connect(ct);
  const ruf = async (args) => { const r = await client.callTool({ name: 'capture', arguments: args }); return { fehler: !!r.isError, text: r.content?.[0]?.text ?? '' }; };
  const t = (await client.listTools()).tools.find(x => x.name === 'capture');
  ok('capture ist registriert: text Pflicht, additiv (nicht destruktiv, nicht readOnly)', t?.inputSchema?.required?.join() === 'text' && t.annotations?.destructiveHint === false && t.annotations?.readOnlyHint === false, t);
  const m1 = await ruf({ text: 'ueber MCP' });
  const j1 = JSON.parse(m1.text);
  ok('MCP capture: Standard-Ordner _Eingang, Ergebnis nennt Vault und Pfad', !m1.fehler && j1.vault === 'test' && /^_Eingang\/\d{4}-\d{2}-\d{2} \d{4} – ueber MCP\.md$/.test(j1.path), m1.text);
  cfg = { capture: { folder: 'Posteingang' } };
  const m2 = await ruf({ text: 'mit Config', titel: 'Aus der Config' });
  ok('capture.folder aus nexus.config.json wird benutzt', !m2.fehler && JSON.parse(m2.text).path.startsWith('Posteingang/'), m2.text);
  const m3 = await ruf({ text: '' });
  ok('MCP capture ohne Text: isError', m3.fehler, m3.text);
} catch (e) {
  console.log('  \x1b[31m✗\x1b[0m Abbruch:', e?.stack || e); fail++;
} finally {
  try { await client?.close(); } catch {}
  try { indexer.db.close?.(); } catch {}
  try { rmSync(scratch, { recursive: true, force: true }); } catch {}
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
