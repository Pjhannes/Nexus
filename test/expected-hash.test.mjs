// test/expected-hash.test.mjs – R31/1: expected_hash fuer write_note, patch, append_to_section.
//
// Zwei Seiten koennen dieselbe Notiz aendern (Connector am Server, App am Laptop). Wer den Hash
// des gelesenen Stands mitgibt, ueberschreibt keine fremde Aenderung: weicht die Datei ab, gibt es
// einen Fehler und es wird nichts geschrieben.
//   A. Helfer inhaltHash / hashAbweichung
//   B. tools: Hash liefern (outline, readNote withHash, Schreib-Ergebnis)
//   C. tools: Schreiben mit passendem / abweichendem / ungueltigem expected_hash
//   D. MCP-Pfad (buildServer, InMemoryTransport)
// Alles im Temp-Scratch. Lauf: node test/expected-hash.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildIndexer } from '../src/indexer.js';
import { makeTools, inhaltHash, hashAbweichung } from '../src/tools.js';
import { buildServer } from '../src/mcp/build-server.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? `\n     Kontext: ${JSON.stringify(extra).slice(0, 500)}` : ''); fail++; }
}

const scratch = mkdtempSync(join(tmpdir(), 'nexus-hash-test-'));
const vaultDir = join(scratch, 'vault');
mkdirSync(vaultDir, { recursive: true });
const indexer = buildIndexer(vaultDir, join(scratch, 'hash.db'), []);
const tools = makeTools(indexer, vaultDir);
const BASIS = '# Titel\n\n## Eins\n\nZeile A\n\n## Zwei\n\nZeile B\n';
const lege = (name, inhalt = BASIS) => { writeFileSync(join(vaultDir, name), inhalt, 'utf8'); indexer.reindex(); };
const platte = (name) => readFileSync(join(vaultDir, name), 'utf8');
const sha = (s) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');
// "Die andere Seite": aendert die Datei am Nexus vorbei (wie Syncthing vom Laptop).
const fremd = (name, inhalt) => writeFileSync(join(vaultDir, name), inhalt, 'utf8');

let client = null;
try {
  console.log('\n── A. Helfer ──');
  ok('inhaltHash: sha256 ueber den UTF-8-Inhalt, Format "sha256:<64 hex>"', inhaltHash('äbc') === sha('äbc') && /^sha256:[0-9a-f]{64}$/.test(inhaltHash('')));
  ok('hashAbweichung: nichts verlangt -> null', hashAbweichung(undefined, 'x', 'a.md') === null && hashAbweichung('', 'x', 'a.md') === null && hashAbweichung(null, 'x', 'a.md') === null);
  ok('hashAbweichung: voller Hash passt', hashAbweichung(sha('x'), 'x', 'a.md') === null);
  ok('hashAbweichung: ohne "sha256:" und in Grossbuchstaben passt', hashAbweichung(sha('x').slice(7).toUpperCase(), 'x', 'a.md') === null);
  ok('hashAbweichung: Anfang ab 12 Hex-Zeichen passt', hashAbweichung(sha('x').slice(0, 7 + 12), 'x', 'a.md') === null);
  ok('hashAbweichung: 11 Hex-Zeichen sind zu kurz', /ungueltig/.test(hashAbweichung(sha('x').slice(7, 7 + 11), 'x', 'a.md') ?? ''));
  ok('hashAbweichung: kein Hex -> ungueltig', /ungueltig/.test(hashAbweichung('sha256:zzzzzzzzzzzzzzzz', 'x', 'a.md') ?? ''));
  const abw = hashAbweichung(sha('alt'), 'neu', 'a.md');
  ok('hashAbweichung: anderer Stand -> Fehler nennt Pfad und aktuellen Hash, "nichts geschrieben"', /a\.md/.test(abw) && abw.includes(sha('neu')) && /nichts geschrieben/.test(abw), abw);

  console.log('\n── B. Hash liefern ──');
  lege('Notiz.md');
  ok('outline nennt den Hash des aktuellen Stands', tools.outline({ path: 'Notiz.md' }).hash === sha(BASIS));
  ok('readNote ohne withHash: Ergebnis wie bisher (kein hash)', Object.keys(tools.readNote({ path: 'Notiz.md' })).join() === 'path,content');
  ok('readNote withHash: ganze Notiz', tools.readNote({ path: 'Notiz.md', withHash: true }).hash === sha(BASIS));
  ok('readNote withHash + section: Hash der GANZEN Datei', tools.readNote({ path: 'Notiz.md', section: 'Eins', withHash: true }).hash === sha(BASIS));
  ok('readNote withHash + lines: Hash der GANZEN Datei', tools.readNote({ path: 'Notiz.md', lines: 2, withHash: true }).hash === sha(BASIS));
  const neu = tools.writeNote({ path: 'Neu.md', content: 'Hallo\n', create: true });
  ok('writeNote neu: hash = neuer Stand, hashVorher = null', neu.ok && neu.hash === sha('Hallo\n') && neu.hashVorher === null, neu);
  const zwei = tools.writeNote({ path: 'Neu.md', content: 'Hallo 2\n' });
  ok('writeNote ueberschreiben: hashVorher = alter Stand', zwei.ok && zwei.hashVorher === sha('Hallo\n') && zwei.hash === sha('Hallo 2\n'), zwei);

  console.log('\n── C. Schreiben mit expected_hash ──');
  lege('W.md');
  const w1 = tools.writeNote({ path: 'W.md', content: 'A\n', expectedHash: sha(BASIS) });
  ok('writeNote: passender Hash -> geschrieben', w1.ok === true && platte('W.md') === 'A\n', w1);
  fremd('W.md', 'FREMD\n');
  const w2 = tools.writeNote({ path: 'W.md', content: 'B\n', expectedHash: w1.hash });
  ok('writeNote: Datei inzwischen geaendert -> Fehler, nichts geschrieben', /Stand abweichend/.test(w2.error ?? '') && platte('W.md') === 'FREMD\n', w2);
  ok('writeNote: Fehler nennt den aktuellen Hash (naechster Versuch ohne Raten)', (w2.error ?? '').includes(sha('FREMD\n')));
  const w3 = tools.writeNote({ path: 'W.md', content: 'B\n', expectedHash: sha('FREMD\n') });
  ok('writeNote: mit dem aktuellen Hash klappt es', w3.ok === true && platte('W.md') === 'B\n', w3);
  const w4 = tools.writeNote({ path: 'Fehlt.md', content: 'x', create: true, expectedHash: sha('x') });
  ok('writeNote: expected_hash fuer eine Notiz, die es nicht gibt -> Fehler, nichts angelegt', /existiert nicht/.test(w4.error ?? '') && !tools.readNote({ path: 'Fehlt.md' }).content, w4);
  const w5 = tools.writeNote({ path: 'W.md', content: 'C\n', expectedHash: 'kaputt' });
  ok('writeNote: ungueltiger expected_hash -> Fehler, nichts geschrieben', /ungueltig/.test(w5.error ?? '') && platte('W.md') === 'B\n', w5);
  ok('writeNote: ohne expected_hash wie bisher (ueberschreibt)', tools.writeNote({ path: 'W.md', content: 'D\n' }).ok === true && platte('W.md') === 'D\n');

  lege('P.md');
  const p1 = tools.patch({ path: 'P.md', patches: [{ old_str: 'Zeile A', new_str: 'Zeile A2' }], expectedHash: sha(BASIS) });
  ok('patch: passender Hash -> angewandt, Ergebnis nennt neuen Hash', p1.ok === true && p1.applied === 1 && p1.hash === sha(platte('P.md')) && p1.hashVorher === sha(BASIS), p1);
  const p2 = tools.patch({ path: 'P.md', patches: [{ old_str: 'Zeile B', new_str: 'Zeile B2' }], expectedHash: sha(BASIS) });
  ok('patch: veralteter Hash -> Fehler, Datei unveraendert', /Stand abweichend/.test(p2.error ?? '') && !platte('P.md').includes('B2'), p2);
  const p3 = tools.patch({ path: 'P.md', patches: [{ old_str: 'Zeile B', new_str: 'Zeile B2' }], expectedHash: p1.hash });
  ok('patch: Kette ueber den Hash aus dem letzten Ergebnis', p3.ok === true && platte('P.md').includes('B2'), p3);

  lege('A.md');
  const a1 = tools.appendToSection({ path: 'A.md', section: 'Eins', text: 'Neu 1', expectedHash: sha(BASIS) });
  ok('append_to_section: passender Hash -> angehaengt', a1.ok === true && platte('A.md').includes('Neu 1') && a1.hashVorher === sha(BASIS), a1);
  const a2 = tools.appendToSection({ path: 'A.md', section: 'Eins', text: 'Neu 2', expectedHash: sha(BASIS) });
  ok('append_to_section: veralteter Hash -> Fehler, nichts angehaengt', /Stand abweichend/.test(a2.error ?? '') && !platte('A.md').includes('Neu 2'), a2);
  ok('append_to_section: ohne expected_hash wie bisher', tools.appendToSection({ path: 'A.md', section: 'Zwei', text: 'Neu 3' }).ok === true && platte('A.md').includes('Neu 3'));

  console.log('\n── D. MCP-Pfad ──');
  const registry = {
    get: () => ({ vault: { name: 'test', path: vaultDir }, tools, indexer }),
    list: () => ({ activeVault: 'test', vaults: [{ name: 'test', path: vaultDir, active: true, notes: 0 }] }),
    config: () => ({}), entries: () => [], refresh: () => {}, size: () => 1,
  };
  const server = buildServer({ registry, info: { version: '0.0.0' } });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  client = new Client({ name: 'hash-test', version: '0.0.0' });
  await client.connect(ct);
  const ruf = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { fehler: !!r.isError, text: r.content?.[0]?.text ?? '' }; };

  const liste = await client.listTools();
  const schema = (n) => liste.tools.find(t => t.name === n)?.inputSchema?.properties ?? {};
  ok('write_note, patch, append_to_section kennen expected_hash', ['write_note', 'patch', 'append_to_section'].every(n => 'expected_hash' in schema(n)));
  ok('expected_hash ist nirgends Pflicht', ['write_note', 'patch', 'append_to_section'].every(n => !(liste.tools.find(t => t.name === n).inputSchema.required ?? []).includes('expected_hash')));
  ok('read_note kennt den Schalter hash', 'hash' in schema('read_note'));

  lege('M.md');
  const o = JSON.parse((await ruf('outline', { path: 'M.md' })).text);
  ok('MCP outline liefert hash', o.hash === sha(BASIS), o);
  const r0 = await ruf('read_note', { path: 'M.md' });
  ok('MCP read_note ohne hash: reiner Notiztext', r0.text === BASIS);
  const r1 = await ruf('read_note', { path: 'M.md', section: 'Eins', hash: true });
  ok('MCP read_note hash:true: letzte Zeile "[hash: …]" der ganzen Datei', r1.text.endsWith(`\n\n[hash: ${sha(BASIS)}]`) && r1.text.startsWith('## Eins'), r1.text);
  const m1 = await ruf('patch', { path: 'M.md', patches: [{ old_str: 'Zeile A', new_str: 'Zeile A9' }], expected_hash: o.hash });
  const m1j = JSON.parse(m1.text);
  ok('MCP patch mit passendem expected_hash: ok, Ergebnis mit hash + hashVorher', !m1.fehler && m1j.ok === true && m1j.hashVorher === o.hash && m1j.hash === sha(platte('M.md')), m1.text);
  const m2 = await ruf('write_note', { path: 'M.md', content: 'weg\n', expected_hash: o.hash });
  ok('MCP write_note mit veraltetem expected_hash: isError, nichts geschrieben', m2.fehler && /Stand abweichend/.test(m2.text) && platte('M.md').includes('Zeile A9'), m2.text);
  const m3 = await ruf('append_to_section', { path: 'M.md', section: 'Zwei', text: 'dazu', expected_hash: m1j.hash });
  ok('MCP append_to_section mit dem Hash aus dem letzten Ergebnis: ok', !m3.fehler && platte('M.md').includes('dazu'), m3.text);
} catch (e) {
  console.log('  \x1b[31m✗\x1b[0m Abbruch:', e?.stack || e); fail++;
} finally {
  try { await client?.close(); } catch {}
  try { indexer.db.close?.(); } catch {}
  try { rmSync(scratch, { recursive: true, force: true }); } catch {}
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
