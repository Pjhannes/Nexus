// test/crlf.test.mjs – R29/N12: patch und append_to_section sind zeilenenden-fest.
//
// Vault-Dateien haben unter Windows oft CRLF, Claude schickt "\n". Vorher fand ein mehrzeiliges
// old_str nichts ("Kein Patch anwendbar"), und append schrieb nackte "\n" in CRLF-Dateien.
//   A. Helfer dateiEol / inEol
//   B. patch: Vergleich zeilenenden-neutral, geschrieben wird im Stil der Datei
//   C. append_to_section: fuegt im Stil der Datei ein
//   D. MCP-Pfad (buildServer, InMemoryTransport)
// Alles im Temp-Scratch. Lauf: node test/crlf.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildIndexer } from '../src/indexer.js';
import { makeTools, dateiEol, inEol } from '../src/tools.js';
import { buildServer } from '../src/mcp/build-server.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? `\n     Kontext: ${String(typeof extra === 'string' ? JSON.stringify(extra) : JSON.stringify(extra)).slice(0, 500)}` : ''); fail++; }
}
const nurCrlf = (s) => !/(^|[^\r])\n/.test(s);     // jedes \n hat ein \r davor
const nurLf   = (s) => !s.includes('\r');

const scratch = mkdtempSync(join(tmpdir(), 'nexus crlf test-'));
const vaultDir = join(scratch, 'vault');
mkdirSync(vaultDir, { recursive: true });
const indexer = buildIndexer(vaultDir, join(scratch, 'crlf.db'), []);
const tools = makeTools(indexer, vaultDir);
const BASIS = ['# Titel', '', '## Eins', '', 'Zeile A', 'Zeile B', 'Zeile C', '', '## Zwei', '', '| x | y |', '|---|---|', '| 1 | 2 |', '', '## Drei', '', 'Ende.', ''];
const lege = (name, eol, zeilen = BASIS) => { writeFileSync(join(vaultDir, name), zeilen.join(eol), 'utf8'); indexer.reindex(); };
const platte = (name) => readFileSync(join(vaultDir, name), 'utf8');

let client = null;
try {
  console.log('\n── A. Helfer ──');
  ok('dateiEol: CRLF-Datei', dateiEol('a\r\nb\r\nc') === '\r\n');
  ok('dateiEol: LF-Datei', dateiEol('a\nb\nc') === '\n');
  ok('dateiEol: ohne Umbruch -> LF', dateiEol('abc') === '\n' && dateiEol('') === '\n');
  ok('dateiEol: gemischt -> Mehrheit', dateiEol('a\r\nb\r\nc\nd') === '\r\n' && dateiEol('a\nb\nc\r\nd') === '\n');
  ok('inEol: LF -> CRLF, schon vorhandenes CRLF wird nicht verdoppelt', inEol('a\nb\r\nc', '\r\n') === 'a\r\nb\r\nc');
  ok('inEol: CRLF -> LF', inEol('a\r\nb\nc', '\n') === 'a\nb\nc');

  console.log('\n── B. patch ──');
  lege('Win.md', '\r\n');
  const p1 = tools.patch({ path: 'Win.md', patches: [{ old_str: 'Zeile A\nZeile B', new_str: 'Zeile A2\nZeile B2\nZeile B3' }] });
  ok('CRLF-Datei: mehrzeiliges old_str mit \\n wird gefunden (vorher: Kein Patch anwendbar)', p1.ok === true && p1.applied === 1 && !p1.missed, p1);
  ok('CRLF-Datei: Inhalt ersetzt', platte('Win.md').includes('Zeile A2\r\nZeile B2\r\nZeile B3\r\nZeile C'), platte('Win.md'));
  ok('CRLF-Datei: bleibt durchgehend CRLF (kein nacktes \\n)', nurCrlf(platte('Win.md')), platte('Win.md'));
  ok('CRLF-Datei: Rest unveraendert', platte('Win.md') === BASIS.join('\r\n').replace('Zeile A\r\nZeile B', 'Zeile A2\r\nZeile B2\r\nZeile B3'));

  const p2 = tools.patch({ path: 'Win.md', patches: [{ old_str: '| x | y |\r\n|---|---|', new_str: '| a | b |\r\n|---|---|' }] });
  ok('CRLF-Datei: old_str mit \\r\\n geht weiter', p2.applied === 1 && platte('Win.md').includes('| a | b |\r\n|---|---|\r\n| 1 | 2 |') && nurCrlf(platte('Win.md')), p2);
  const p3 = tools.patch({ path: 'Win.md', patches: [{ old_str: 'Ende.', new_str: 'Schluss.\nNoch eine Zeile.' }] });
  ok('CRLF-Datei: einzeiliges old_str, mehrzeiliges new_str -> als CRLF geschrieben', p3.applied === 1 && platte('Win.md').includes('Schluss.\r\nNoch eine Zeile.\r\n') && nurCrlf(platte('Win.md')), platte('Win.md').slice(-60));
  const p4 = tools.patch({ path: 'Win.md', patches: [{ old_str: '\nZeile C\n' , new_str: '\n' }] });
  ok('CRLF-Datei: ganze Zeile loeschen (old_str mit Umbruch vorn und hinten)', p4.applied === 1 && platte('Win.md').includes('Zeile B3\r\n\r\n## Zwei') && nurCrlf(platte('Win.md')), platte('Win.md'));
  const p5 = tools.patch({ path: 'Win.md', patches: [{ old_str: '| 1 | 2 |\n' }] });
  ok('CRLF-Datei: ohne new_str = loeschen', p5.applied === 1 && !platte('Win.md').includes('| 1 | 2 |') && nurCrlf(platte('Win.md')), p5);

  lege('Unix.md', '\n');
  const u1 = tools.patch({ path: 'Unix.md', patches: [{ old_str: 'Zeile A\r\nZeile B', new_str: 'Zeile A2\r\nZeile B2' }] });
  ok('LF-Datei: old_str/new_str mit \\r\\n werden gefunden und als LF geschrieben', u1.applied === 1 && platte('Unix.md').includes('Zeile A2\nZeile B2\nZeile C') && nurLf(platte('Unix.md')), u1);
  const u2 = tools.patch({ path: 'Unix.md', patches: [{ old_str: 'Zeile A2\nZeile B2', new_str: 'Zeile A\nZeile B' }] });
  ok('LF-Datei: mehrzeilig mit \\n wie bisher', u2.applied === 1 && platte('Unix.md') === BASIS.join('\n'), u2);

  // Batch + Laengen-Invariante + Meldung fehlender Patches
  lege('Batch.md', '\r\n');
  const vorher = platte('Batch.md');
  const b = tools.patch({ path: 'Batch.md', patches: [
    { old_str: '## Eins\n\nZeile A', new_str: '## Eins\n\nZeile A (neu)' },
    { old_str: 'gibt es\nnicht', new_str: 'x' },
    { old_str: 'Ende.', new_str: 'Ende!' },
  ] });
  ok('Batch: zwei angewandt, einer gemeldet, Laenge passt', b.ok === true && b.applied === 2 && b.missed?.length === 1 && b.missed[0].startsWith('gibt es') &&
    platte('Batch.md').length === vorher.length + ' (neu)'.length && nurCrlf(platte('Batch.md')), b);
  const keiner = tools.patch({ path: 'Batch.md', patches: [{ old_str: 'Zeile B\nZeile A', new_str: 'x' }] });
  ok('nichts gefunden -> Fehler, Datei unveraendert', keiner.error === 'Kein Patch anwendbar' && platte('Batch.md') === vorher.replace('Zeile A', 'Zeile A (neu)').replace('Ende.', 'Ende!'), keiner);

  // Regex-Sonderzeichen im mehrzeiligen old_str sind woertlich gemeint
  lege('Regex.md', '\r\n', ['# R', '', 'axb (c) [d]*', '| x |', '', 'a.b (c) [d]*', '| x |', '', 'Preis: $5 ^ {n} \\ ende', 'fertig', '']);
  const r1 = tools.patch({ path: 'Regex.md', patches: [{ old_str: 'a.b (c) [d]*\n| x |', new_str: 'ERSETZT' }] });
  ok('Sonderzeichen woertlich: "a.b" trifft nicht "axb"', r1.applied === 1 && platte('Regex.md') === ['# R', '', 'axb (c) [d]*', '| x |', '', 'ERSETZT', '', 'Preis: $5 ^ {n} \\ ende', 'fertig', ''].join('\r\n'), platte('Regex.md'));
  const r2 = tools.patch({ path: 'Regex.md', patches: [{ old_str: 'Preis: $5 ^ {n} \\ ende\nfertig', new_str: 'ok' }] });
  ok('Sonderzeichen woertlich: $ ^ { } \\ im Suchtext', r2.applied === 1 && platte('Regex.md').endsWith('ok\r\n'), platte('Regex.md'));

  // "$"-Muster im new_str duerfen nicht als Ersetzungsmuster gelesen werden (LaTeX!)
  lege('Mathe.md', '\r\n', ['# M', '', 'FORMEL', 'ZWEI', '']);
  const m1 = tools.patch({ path: 'Mathe.md', patches: [{ old_str: 'FORMEL', new_str: '$$E = mc^2$$ und $& sowie $1' }] });
  ok('new_str mit $$, $&, $1 kommt woertlich an (vorher: Laengen-Invariante verletzt)', m1.ok === true && platte('Mathe.md').includes('$$E = mc^2$$ und $& sowie $1\r\nZWEI'), m1);

  // Nur die erste Fundstelle
  lege('Doppelt.md', '\r\n', ['# D', '', 'x', 'y', '', 'x', 'y', '']);
  tools.patch({ path: 'Doppelt.md', patches: [{ old_str: 'x\ny', new_str: 'EINMAL' }] });
  ok('nur die erste Fundstelle wird ersetzt', platte('Doppelt.md') === ['# D', '', 'EINMAL', '', 'x', 'y', ''].join('\r\n'), platte('Doppelt.md'));

  // Gemischte Datei: nur die Fundstelle aendert sich, jedes andere Byte bleibt
  const gemischt = '# G\r\n\r\nalt eins\r\nalt zwei\r\n\r\nUnix-Zeile 1\nUnix-Zeile 2\n\r\nSchluss\r\n';
  writeFileSync(join(vaultDir, 'Mix.md'), gemischt, 'utf8'); indexer.reindex();
  const g1 = tools.patch({ path: 'Mix.md', patches: [{ old_str: 'Unix-Zeile 1\nUnix-Zeile 2', new_str: 'U1\nU2' }] });
  ok('gemischte Datei: Fundstelle im Mehrheits-Stil, Rest byte-gleich', g1.applied === 1 && platte('Mix.md') === '# G\r\n\r\nalt eins\r\nalt zwei\r\n\r\nU1\r\nU2\n\r\nSchluss\r\n', platte('Mix.md'));
  const g2 = tools.patch({ path: 'Mix.md', patches: [{ old_str: 'U2\n\nSchluss', new_str: 'U2\n\nENDE' }] });
  ok('gemischte Datei: old_str ueber \\n UND \\r\\n hinweg wird gefunden', g2.applied === 1 && platte('Mix.md').endsWith('U1\r\nU2\r\n\r\nENDE\r\n'), platte('Mix.md'));

  console.log('\n── C. append_to_section ──');
  lege('WinA.md', '\r\n');
  const a1 = tools.appendToSection({ path: 'WinA.md', section: 'Eins', text: 'neu 1\nneu 2' });
  ok('CRLF-Datei: mitten einfuegen bleibt CRLF (vorher: nackte \\n)', a1.ok === true && nurCrlf(platte('WinA.md')), platte('WinA.md'));
  ok('CRLF-Datei: Text steht am Ende des Abschnitts', platte('WinA.md').includes('Zeile C\r\n\r\n\r\nneu 1\r\nneu 2\r\n## Zwei'), platte('WinA.md'));
  const a2 = tools.appendToSection({ path: 'WinA.md', section: 'Drei', text: 'ganz hinten' });
  ok('CRLF-Datei: am Dateiende anhaengen bleibt CRLF', a2.ok === true && nurCrlf(platte('WinA.md')) && platte('WinA.md').endsWith('Ende.\r\n\r\n\r\nganz hinten'), platte('WinA.md').slice(-40));
  ok('CRLF-Datei: nichts verloren', BASIS.filter(Boolean).every(z => platte('WinA.md').includes(z)));
  ok('CRLF-Datei: Abschnitt danach lesbar (Index stimmt)', tools.readNote({ path: 'WinA.md', section: 'Zwei' }).content.startsWith('## Zwei\r\n\r\n| x | y |'));

  lege('UnixA.md', '\n');
  tools.appendToSection({ path: 'UnixA.md', section: 'Eins', text: 'neu 1\r\nneu 2' });
  ok('LF-Datei: Text mit \\r\\n wird als LF eingefuegt', nurLf(platte('UnixA.md')) && platte('UnixA.md').includes('Zeile C\n\n\nneu 1\nneu 2\n## Zwei'), platte('UnixA.md'));
  // LF-Dateien: Ergebnis exakt wie die alte split/splice/join-Rechnung
  lege('Alt.md', '\n');
  const zeilen = BASIS.join('\n').split('\n'); zeilen.splice(BASIS.indexOf('## Zwei'), 0, '', 'T'); const mitte = zeilen.join('\n');
  tools.appendToSection({ path: 'Alt.md', section: 'Eins', text: 'T' });
  ok('LF-Datei: mitten einfuegen byte-gleich zum bisherigen Verhalten', platte('Alt.md') === mitte, platte('Alt.md'));
  lege('Alt2.md', '\n');
  tools.appendToSection({ path: 'Alt2.md', section: 'Drei', text: 'T' });   // letzter Abschnitt = Dateiende
  ok('LF-Datei: am Ende anhaengen byte-gleich zum bisherigen Verhalten', platte('Alt2.md') === [...BASIS.join('\n').split('\n'), '', 'T'].join('\n'), platte('Alt2.md').slice(-20));

  console.log('\n── D. MCP ──');
  lege('Mcp.md', '\r\n');
  const registry = { get: () => ({ vault: { name: 'vault', path: vaultDir }, tools }), list: () => ({ activeVault: 'vault', vaults: [] }), config: () => ({}) };
  const [c, s] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'crlf-test', version: '0.0.0' });
  await Promise.all([buildServer({ registry }).connect(s), client.connect(c)]);
  const mp = await client.callTool({ name: 'patch', arguments: { path: 'Mcp.md', patches: [{ old_str: '## Eins\n\nZeile A\nZeile B\nZeile C', new_str: '## Eins\n\nEin Absatz.' }] } });
  ok('MCP patch: mehrzeilige Aenderung in einem Aufruf', mp.isError !== true && JSON.parse(mp.content[0].text).applied === 1 && platte('Mcp.md').includes('## Eins\r\n\r\nEin Absatz.\r\n\r\n## Zwei') && nurCrlf(platte('Mcp.md')), mp.content?.[0]?.text);
  const ma = await client.callTool({ name: 'append_to_section', arguments: { path: 'Mcp.md', section: 'Eins', text: '- Punkt 1\n- Punkt 2' } });
  ok('MCP append_to_section: CRLF bleibt CRLF', ma.isError !== true && nurCrlf(platte('Mcp.md')) && platte('Mcp.md').includes('- Punkt 1\r\n- Punkt 2\r\n## Zwei'), platte('Mcp.md'));
} catch (e) {
  console.error('  \x1b[31m✗ Testlauf-Fehler:\x1b[0m', e.stack || e.message);
  fail++;
} finally {
  try { await client?.close(); } catch {}
  try { indexer.db.close(); } catch {}
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.log('  (Hinweis: Scratch-Ordner nicht entfernt – EPERM/WAL, unkritisch)'); }
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
