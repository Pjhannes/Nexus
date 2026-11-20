// test/fts-query.test.mjs – R29/N1: Such-Operatoren (Phrasen, AND/OR/NOT, Praefix, Rueckfall).
//
//   A. Parser pur (src/fts-query.js): Eingabe -> MATCH-Ausdruck / positive Suchwoerter / Rueckfall
//   B. Gegen echtes FTS5 (buildIndexer + makeTools): die Operatoren TUN, was die Tool-Beschreibung sagt
//   C. UI-Pfad: /api/search (ui-server) nutzt dieselbe Funktion und liefert "terms";
//      hitTokens aus public/index.html (R23-Treffermarkierung) markiert damit keine Operatoren.
// Alles im Temp-Scratch. Lauf: node test/fts-query.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { parseFtsQuery, buildFtsQuery, fallbackFtsQuery } from '../src/fts-query.js';
import { buildIndexer } from '../src/indexer.js';
import { makeTools } from '../src/tools.js';

const __dir = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? `\n     Kontext: ${String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400)}` : ''); fail++; }
}
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── A. Parser ──');
// ═════════════════════════════════════════════════════════════════════════════
const faelle = [
  // [Eingabe, MATCH, terms, fallback]
  ['Carnot',                         '"carnot"*',                                   ['carnot'], false],
  ['Erster Hauptsatz',               '"erster" AND "hauptsatz"*',                   ['erster', 'hauptsatz'], false],
  ['"Custom Connector"',             '"custom connector"',                          ['custom', 'connector'], false],
  ['"Remote-MCP" OR "Custom Connector"', '"remote mcp" OR "custom connector"',      ['remote', 'mcp', 'custom', 'connector'], false],
  ['Carnot AND Wirkungsgrad',        '"carnot" AND "wirkungsgrad"*',                ['carnot', 'wirkungsgrad'], false],
  ['Connector NOT Remote',           '"connector" NOT "remote"',                    ['connector'], false],
  ['therm* Carnot',                  '"therm"* AND "carnot"*',                      ['therm', 'carnot'], false],
  ['"Erster Haupt"*',                '"erster haupt"*',                             ['erster', 'haupt'], false],
  ['Remote-MCP',                     '"remote mcp"*',                               ['remote', 'mcp'], false],
  ['Remote-MCP Server',              '"remote mcp" AND "server"*',                  ['remote', 'mcp', 'server'], false],
  ['(Carnot OR Otto) AND Wirkungsgrad', '("carnot" OR "otto") AND "wirkungsgrad"*', ['carnot', 'otto', 'wirkungsgrad'], false],
  ['Motor (Carnot OR Otto)',         '"motor" AND ("carnot" OR "otto")',            ['motor', 'carnot', 'otto'], false],
  ['Motor NOT (Carnot OR Otto) Diesel', '"motor" NOT ("carnot" OR "otto") AND "diesel"*', ['motor', 'diesel'], false],
  ['a or b',                         '"a" AND "or" AND "b"*',                       ['a', 'or', 'b'], false],   // klein = Suchwort
  ['NEAR title:foo ^bar',            '"near" AND "title foo" AND "bar"*',           ['near', 'title', 'foo', 'bar'], false],
  ['  Übung   Größe  ',              '"übung" AND "größe"*',                        ['übung', 'größe'], false],
  ['"" Carnot',                      '"carnot"*',                                   ['carnot'], false],
  // Syntaxfehler -> bereinigte Suche
  ['"offen Carnot',                  '"offen" AND "carnot"*',                       ['offen', 'carnot'], true],
  ['Carnot AND',                     '"carnot"*',                                   ['carnot'], true],
  ['OR Carnot',                      '"carnot"*',                                   ['carnot'], true],
  ['NOT Carnot',                     '"carnot"*',                                   ['carnot'], true],
  ['Carnot AND OR Otto',             '"carnot" AND "otto"*',                        ['carnot', 'otto'], true],
  ['(Carnot OR Otto',                '"carnot" AND "otto"*',                        ['carnot', 'otto'], true],
  ['Carnot) Otto',                   '"carnot" AND "otto"*',                        ['carnot', 'otto'], true],
  ['()',                             null,                                          [], true],
  ['Carnot++-"()',                   '"carnot"*',                                   ['carnot'], true],
  // nichts Suchbares
  ['---+++',                         null,                                          [], false],
  ['',                               null,                                          [], false],
  ['   ',                            null,                                          [], false],
  ['*',                              null,                                          [], false],
];
for (const [q, match, terms, fallback] of faelle) {
  const r = parseFtsQuery(q);
  ok(`${JSON.stringify(q)} -> ${match}`, r.match === match && gleich(r.terms, terms) && r.fallback === fallback, r);
}
ok('buildFtsQuery liefert nur den MATCH-Ausdruck', buildFtsQuery('a OR b') === '"a" OR "b"*');
ok('parseFtsQuery vertraegt undefined/null/Zahl', parseFtsQuery(undefined).match === null && parseFtsQuery(null).match === null && parseFtsQuery(42).match === '"42"*');
ok('fallbackFtsQuery: Operator-Woerter fliegen raus', fallbackFtsQuery('a AND OR NOT b').match === '"a" AND "b"*');
ok('der alte Fehler ist weg: kein "OR*" im Ausdruck', !/OR\*/.test(buildFtsQuery('"Remote-MCP" OR "Custom Connector"')));

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n── B. Echtes FTS5 ──');
// ═════════════════════════════════════════════════════════════════════════════
const scratch = mkdtempSync(join(tmpdir(), 'nexus fts test-'));
const vaultDir = join(scratch, 'vault');
mkdirSync(vaultDir, { recursive: true });
const notiz = (name, text) => writeFileSync(join(vaultDir, name), text, 'utf8');
notiz('Remote.md',   '# Remote\n\nDer Remote-MCP Server laeuft auf dem Heimserver.\n');
notiz('Custom.md',   '# Custom\n\nEinen Custom Connector in den Einstellungen anlegen.\n');
notiz('Getrennt.md', '# Getrennt\n\nDer Connector kennt eigene Felder, Custom ist nur ein Feld davon.\n');
notiz('Waerme.md',   '# Thermodynamik\n\nErster Hauptsatz und der Carnot-Wirkungsgrad.\n');
notiz('Otto.md',     '# Otto\n\nDer Otto Motor hat einen Wirkungsgrad, aber keinen Namen aus Frankreich.\n');
notiz('Oder.md',     '# Oder\n\nDie Stadt an der OR liegt nicht an der Oder.\n');

const indexer = buildIndexer(vaultDir, join(scratch, 'fts.db'), []);
indexer.reindex();
const tools = makeTools(indexer, vaultDir);
const pfade = (q, opts = {}) => tools.search({ q, limit: 20, ...opts }).map(r => r.path).sort();
const sucht = (label, q, soll) => { let ist, err; try { ist = pfade(q); } catch (e) { err = e.message; } ok(`${label}: ${q}`, !err && gleich(ist, [...soll].sort()), err ?? ist); };

let srv = null;
try {
  sucht('der reproduzierte Fehlerfall (vorher: fts5 syntax error near "*")', '"Remote-MCP" OR "Custom Connector"', ['Remote.md', 'Custom.md']);
  sucht('Phrase: nur direkt hintereinander', '"Custom Connector"', ['Custom.md']);
  sucht('zwei Woerter = AND, Reihenfolge egal', 'Custom Connector', ['Custom.md', 'Getrennt.md']);
  sucht('explizites AND', 'Custom AND Connector', ['Custom.md', 'Getrennt.md']);
  sucht('OR', 'Heimserver OR Frankreich', ['Remote.md', 'Otto.md']);
  sucht('NOT', 'Connector NOT Einstellungen', ['Getrennt.md']);
  sucht('NOT mit Klammer', 'Wirkungsgrad NOT (Otto OR Frankreich)', ['Waerme.md']);
  sucht('Klammern + AND', '(Carnot OR Otto) AND Wirkungsgrad', ['Waerme.md', 'Otto.md']);
  sucht('Wort neben Klammer (implizites AND)', 'Motor (Carnot OR Otto)', ['Otto.md']);
  sucht('letztes Wort ist Wortanfang', 'Thermo', ['Waerme.md']);
  sucht('letztes Wort ist Wortanfang (zwei Woerter)', 'Erster Haupt', ['Waerme.md']);
  sucht('KEIN Praefix mitten in der Anfrage (vorher: jedes Wort mit *)', 'Thermo Carnot', []);
  sucht('expliziter Praefix mitten in der Anfrage', 'Thermo* Carnot', ['Waerme.md']);
  sucht('Phrase am Ende ist KEIN Wortanfang', '"Thermo"', []);
  sucht('Phrasen-Praefix', '"Erster Haupt"*', ['Waerme.md']);
  sucht('Bindestrich-Wort = Phrase', 'Remote-MCP', ['Remote.md']);
  sucht('kleines "or" ist ein Suchwort', 'Stadt or', ['Oder.md']);
  // Rueckfall statt Fehler
  sucht('offenes Anfuehrungszeichen -> bereinigte Suche', '"Custom Connector', ['Custom.md', 'Getrennt.md']);
  sucht('Operator am Ende -> bereinigte Suche', 'Carnot AND', ['Waerme.md']);
  sucht('offene Klammer -> bereinigte Suche', '(Otto Wirkungsgrad', ['Otto.md']);
  sucht('NOT am Anfang -> bereinigte Suche', 'NOT Carnot', ['Waerme.md']);
  sucht('FTS5-Sonderzeichen brechen nichts', 'Carnot ^ : + - NEAR(', []);
  sucht('nur Sonderzeichen -> leer', '+++ --- ***', []);
  // Pagination laeuft ueber denselben Ausdruck
  const s1 = pfade('Wirkungsgrad OR Connector', { limit: 2 });
  const s2 = pfade('Wirkungsgrad OR Connector', { limit: 2, offset: 2 });
  ok('offset: Seite 2 schliesst an Seite 1 an (4 Treffer, keine Dopplung)', s1.length === 2 && s2.length === 2 && new Set([...s1, ...s2]).size === 4, [s1, s2]);
  // Snippet: Phrase wird als Ganzes markiert, der Treffer beginnt mit dem ersten Suchwort
  const snip = tools.search({ q: '"Custom Connector"' })[0]?.snippet ?? '';
  ok('Snippet markiert die Phrase', /\*\*Custom Connector\*\*/.test(snip), snip);

  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n── C. UI-Pfad (/api/search + Treffermarkierung) ──');
  // ═══════════════════════════════════════════════════════════════════════════
  // hitTokens stammt 1:1 aus public/index.html (zwischen den Markern, DOM-frei).
  const html = readFileSync(join(__dir, '..', 'public', 'index.html'), 'utf8');
  const a = html.indexOf('//__HIT_START__'), b = html.indexOf('//__HIT_END__');
  ok('index.html: Marker //__HIT_START__/__HIT_END__ vorhanden', a > 0 && b > a);
  const { hitTokens } = await import('data:text/javascript,' + encodeURIComponent(html.slice(a, b) + '\nexport {hitTokens};'));

  const PORT = 3985, TOKEN = 'cd'.repeat(32);
  indexer.db.close();                                   // der ui-server oeffnet seinen eigenen Index
  writeFileSync(join(scratch, 'nexus.config.json'), JSON.stringify({
    vaultsRoot: scratch, activeVault: 'vault',
    vaults: [{ name: 'vault', path: vaultDir, dbPath: '.nexus/vault.db' }],
    ui: { port: PORT, autoOpen: false },
    ignore: ['.obsidian', '.trash', '.nexus', 'node_modules'],
  }, null, 2), 'utf8');
  srv = spawn(process.execPath, [join(__dir, '..', 'src', 'ui-server.js')], {
    env: { ...process.env, NEXUS_DATA_DIR: scratch, NEXUS_PORT: String(PORT), NEXUS_DEV: '', NEXUS_SHELL: '', NEXUS_WEB: '', NEXUS_UI_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  const H = { 'X-Nexus-Token': TOKEN };
  let da = false;
  for (let i = 0; i < 150 && !da; i++) {
    try { da = (await fetch(`http://127.0.0.1:${PORT}/api/version`, { headers: H })).ok; } catch { /* noch nicht da */ }
    if (!da) await new Promise(r => setTimeout(r, 100));
  }
  ok('ui-server startet', da, log.slice(-400));
  const api = async (q, extra = '') => {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/search?vault=vault&q=${encodeURIComponent(q)}${extra}`, { headers: H });
    return { status: r.status, json: await r.json() };
  };

  const orSuche = await api('"Remote-MCP" OR "Custom Connector"');
  ok('/api/search: Operator-Anfrage -> 200 statt 500', orSuche.status === 200 && Array.isArray(orSuche.json), orSuche);
  ok('/api/search: findet beide Notizen', gleich(orSuche.json.map(r => r.path).sort(), ['Custom.md', 'Remote.md']), orSuche.json);
  ok('/api/search: terms aus demselben Parser, ohne "or"', orSuche.json.every(r => gleich(r.terms, parseFtsQuery('"Remote-MCP" OR "Custom Connector"').terms)) && !orSuche.json[0].terms.includes('or'), orSuche.json[0]);
  for (const r of orSuche.json) {
    const tk = hitTokens({ q: '"Remote-MCP" OR "Custom Connector"', snippet: r.snippet, terms: r.terms });
    ok(`Markierung ${r.path}: Treffer aus dem Snippet, kein "or"`, tk.length > 0 && !tk.includes('or') && tk.every(t => r.terms.some(w => t.startsWith(w))), tk);
  }
  const tkCustom = hitTokens(Object.assign({ q: '"Custom Connector"' }, (await api('"Custom Connector"')).json[0]));
  ok('Markierung Phrase: "custom connector" als ein Treffer', gleich(tkCustom, ['custom connector']), tkCustom);

  const notSuche = await api('Connector NOT Einstellungen');
  ok('/api/search: NOT-Begriff steht nicht in terms', notSuche.status === 200 && gleich(notSuche.json[0]?.terms, ['connector']), notSuche.json);
  // Ohne Snippet-Treffer greift der Rueckfall auf die Suchwoerter – genau dort leuchteten frueher "not"/"or" auf.
  ok('Markierung ohne Snippet: nur positive Woerter', gleich(hitTokens({ q: 'Connector NOT Einstellungen', snippet: '', terms: notSuche.json[0]?.terms }), ['connector']));
  ok('Markierung alter Server (kein terms): Woerter der Eingabe wie bisher', gleich(hitTokens({ q: 'Carnot Wirk', snippet: 'der **Carnot**-**Wirkungsgrad** und **fett**' }), ['carnot', 'wirkungsgrad']));

  const tipp = await api('Therm', '&limit=12');           // Palette: Tippen, letztes Wort = Wortanfang
  ok('/api/search (Palette): Wortanfang beim Tippen', tipp.json.some(r => r.path === 'Waerme.md'), tipp.json);
  const tkTipp = hitTokens(Object.assign({ q: 'Therm' }, tipp.json.find(r => r.path === 'Waerme.md')));
  ok('Markierung beim Tippen: ganzes Trefferwort', tkTipp.includes('thermodynamik'), tkTipp);

  const kaputt = await api('"offen Carnot AND (');
  ok('/api/search: kaputte Syntax -> 200 + Treffer der bereinigten Suche', kaputt.status === 200 && Array.isArray(kaputt.json), kaputt);
  const leer = await api('+++');
  ok('/api/search: nur Sonderzeichen -> leere Liste', leer.status === 200 && gleich(leer.json, []), leer);
  const ohneQ = await (await fetch(`http://127.0.0.1:${PORT}/api/search?vault=vault`, { headers: H })).json();
  ok('/api/search ohne q: Notizliste wie bisher (ohne terms)', Array.isArray(ohneQ) && ohneQ.length === 6 && ohneQ.every(r => !('terms' in r)), ohneQ);
} catch (e) {
  console.error('  \x1b[31m✗ Testlauf-Fehler:\x1b[0m', e.stack || e.message);
  fail++;
} finally {
  if (srv && srv.exitCode === null) { srv.kill(); await new Promise(r => { srv.on('exit', r); setTimeout(r, 3000); }); }
  try { indexer.db.close(); } catch { /* schon zu */ }
  await new Promise(r => setTimeout(r, 300));
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.log('  (Hinweis: Scratch-Ordner nicht entfernt – EPERM/WAL, unkritisch)'); }
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
