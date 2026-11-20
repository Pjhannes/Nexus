// test/read-section.test.mjs – R29/N2: read_note(section) liefert genau den Abschnitt.
//
//   A. tools.readNote: Ende = naechste Ueberschrift gleicher/hoeherer Ebene (nicht mehr stur 30 Zeilen),
//      exakter Titel vor Teiltreffer, truncated + sectionLines, CRLF, veralteter Index,
//      unbekannter Abschnitt = Fehler mit der Liste der vorhandenen Ueberschriften
//   B. tools.appendToSection nutzt dieselbe Abschnitts-Regel
//   C. MCP read_note (buildServer, InMemoryTransport): Kuerzung/Nicht-gefunden stehen im Text
// Alles im Temp-Scratch. Lauf: node test/read-section.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildIndexer } from '../src/indexer.js';
import { makeTools, SECTION_MAX_LINES, SECTION_LISTE_MAX, ueberschriftenListe } from '../src/tools.js';
import { buildServer } from '../src/mcp/build-server.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? `\n     Kontext: ${String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 500)}` : ''); fail++; }
}

const scratch = mkdtempSync(join(tmpdir(), 'nexus section test-'));
const vaultDir = join(scratch, 'vault');
mkdirSync(vaultDir, { recursive: true });

const lang = Array.from({ length: 300 }, (_, i) => `Langzeile ${i + 1}`);
const mittel = Array.from({ length: 45 }, (_, i) => `Mittelzeile ${i + 1}`);
const PLAN = [
  '---', 'title: Plan', '---',
  '# Plan', '', 'Intro.', '',
  '## Vor-Setup', '', 'Das kommt VOR dem Setup.', '',
  '## Setup', '', 'Setup-Text.', '',
  '### Details', '', 'Detail-Text.', '',
  '#### Tiefer', '', 'ganz tief.', '',
  '## 🔒 12. Sicherheit', '', 'zwoelf.', '',
  '## 🔒 13. Betrieb', '', 'dreizehn.', '',
  '## Mittel', '', ...mittel, '',
  '# Anhang', '', 'Anhang-Intro.', '',
  '## Setup extra', '', 'nur ein Teiltreffer.', '',
  '## Lang', '', ...lang, '',
].join('\n');
writeFileSync(join(vaultDir, 'Plan.md'), PLAN, 'utf8');
writeFileSync(join(vaultDir, 'Win.md'), '# Win\r\n\r\n## Eins\r\n\r\nerste Zeile\r\nzweite Zeile\r\n\r\n## Zwei\r\n\r\nzwei.\r\n', 'utf8');

const indexer = buildIndexer(vaultDir, join(scratch, 'sec.db'), []);
indexer.reindex();
const tools = makeTools(indexer, vaultDir);
const lies = (section, lines, path = 'Plan.md') => tools.readNote({ path, section, lines });
const zeilen = (r) => (r.content ?? '').split('\n');

let client = null;
try {
  console.log('\n── A. readNote(section) ──');
  const setup = lies('Setup');
  ok('exakter Titel gewinnt vor dem frueheren Teiltreffer ("Vor-Setup")', setup.section === 'Setup' && zeilen(setup)[0] === '## Setup', setup);
  ok('Abschnitt enthaelt seine Unterabschnitte', setup.content.includes('### Details') && setup.content.includes('#### Tiefer') && setup.content.includes('ganz tief.'), setup.content);
  ok('Abschnitt endet VOR der naechsten Ueberschrift gleicher Ebene', !setup.content.includes('12. Sicherheit') && !setup.content.includes('zwoelf'), setup.content);
  ok('keine Leerzeilen am Abschnittsende', zeilen(setup).at(-1) === 'ganz tief.', zeilen(setup).slice(-2));
  ok('nicht gekuerzt: truncated=false, sectionLines = gelieferte Zeilen', setup.truncated === false && setup.sectionLines === zeilen(setup).length && setup.sectionLines === 11, setup);
  ok('Ergebnis nennt Ebene und Zeile der Ueberschrift', setup.level === 2 && PLAN.split('\n')[setup.line - 1] === '## Setup', setup);

  ok('Gross/Klein egal: "setup" -> Setup', lies('setup').section === 'Setup');
  ok('fuehrende # werden ignoriert: "## Setup" -> Setup', lies('## Setup').section === 'Setup');
  ok('Teiltreffer, wenn nichts exakt passt: "Vor" -> Vor-Setup', lies('Vor').section === 'Vor-Setup');
  ok('Teiltreffer nimmt den ersten in Dateireihenfolge: "etup e" -> Setup extra', lies('etup e').section === 'Setup extra');

  const zwoelf = lies('🔒 12.');
  ok('der gemeldete Fall: Abschnitt 12 OHNE den Anfang von 13', zwoelf.section === '🔒 12. Sicherheit' && zwoelf.content.includes('zwoelf.') && !zwoelf.content.includes('13.') && !zwoelf.content.includes('dreizehn'), zwoelf.content);

  const details = lies('Details');
  ok('Ebene 3 endet an der naechsten Ueberschrift <= 3 (tiefere bleiben drin)', details.content.includes('#### Tiefer') && !details.content.includes('12. Sicherheit') && zeilen(details)[0] === '### Details', details.content);
  const tiefer = lies('Tiefer');
  ok('Ebene 4 endet an der naechsten hoeheren Ueberschrift', tiefer.content === '#### Tiefer\n\nganz tief.', tiefer.content);
  const plan = lies('Plan', 2000);
  ok('Ebene 1 reicht bis zur naechsten "#"-Ueberschrift', plan.content.includes('## 🔒 13. Betrieb') && plan.content.includes('Mittelzeile 45') && !plan.content.includes('# Anhang'), zeilen(plan).slice(-3));

  const mittelR = lies('Mittel');
  ok('Abschnitt mit 45 Zeilen kommt ganz (vorher: nach 30 Zeilen abgeschnitten)', mittelR.truncated === false && mittelR.content.includes('Mittelzeile 45') && mittelR.sectionLines === 47, mittelR.sectionLines);

  const langR = lies('Lang');
  ok(`langer Abschnitt ohne lines: ${SECTION_MAX_LINES} Zeilen + truncated`, langR.truncated === true && zeilen(langR).length === SECTION_MAX_LINES && langR.sectionLines === 302, { n: zeilen(langR).length, sectionLines: langR.sectionLines });
  ok('letzter Abschnitt reicht bis zum Dateiende', lies('Lang', 2000).content.endsWith('Langzeile 300') && lies('Lang', 2000).truncated === false);
  const lang250 = lies('Lang', 250);
  ok('lines begrenzt den Abschnitt und meldet truncated', zeilen(lang250).length === 250 && lang250.truncated === true && lang250.sectionLines === 302);
  const setup2 = lies('Setup', 2);
  ok('lines kleiner als der Abschnitt: genau so viele Zeilen, truncated', zeilen(setup2).length === 2 && setup2.truncated === true && setup2.sectionLines === 11, setup2);
  ok('lines groesser als der Abschnitt: endet trotzdem am Abschnittsende', lies('Setup', 500).content === setup.content && lies('Setup', 500).truncated === false);

  // Unbekannter Abschnitt: Fehler mit den vorhandenen Ueberschriften – NICHT die ganze Notiz
  const fehlt = lies('Gibt es nicht');
  ok('unbekannter Abschnitt: Fehler statt Notiz-Inhalt', typeof fehlt.error === 'string' && !('content' in fehlt), Object.keys(fehlt));
  ok('Fehler nennt Abschnitt und Notiz', fehlt.error.startsWith('Abschnitt "Gibt es nicht" nicht gefunden in Plan.md. Vorhandene Ueberschriften (11):\n'), fehlt.error.slice(0, 120));
  const liste = fehlt.error.split('\n').slice(1);
  ok('Fehler listet ALLE Ueberschriften mit Ebene, in Dateireihenfolge', liste.join('|') ===
    '# Plan|## Vor-Setup|## Setup|### Details|#### Tiefer|## 🔒 12. Sicherheit|## 🔒 13. Betrieb|## Mittel|# Anhang|## Setup extra|## Lang', liste);
  ok('Fehler enthaelt keinen Notiztext', !fehlt.error.includes('Langzeile') && !fehlt.error.includes('Intro.') && fehlt.error.length < 400, fehlt.error.length);
  ok('jede gelistete Ueberschrift ist so direkt lesbar', liste.every(z => !lies(z).error && lies(z).section === z.replace(/^#+ /, '')), liste.filter(z => lies(z).error));
  ok('unbekannter Abschnitt + lines: ebenfalls Fehler (lines rettet nichts)', typeof lies('Gibt es nicht', 5).error === 'string' && !('content' in lies('Gibt es nicht', 5)));
  ok('leere/reine-#-Angabe zaehlt als nicht gefunden', typeof lies('##').error === 'string' && typeof lies('   ').error === 'string');
  const ohne = tools.readNote({ path: 'Plan.md' });
  ok('ohne section: unveraendert die ganze Notiz', ohne.content === PLAN && !ohne.error && Object.keys(ohne).join() === 'path,content');
  const ohne5 = tools.readNote({ path: 'Plan.md', lines: 5 });
  ok('lines ohne section: unveraendert der Anfang + truncated', zeilen(ohne5).length === 5 && ohne5.truncated === true && ohne5.totalLines === PLAN.split('\n').length);

  writeFileSync(join(vaultDir, 'Flach.md'), 'Nur Text.\nKeine Ueberschrift.\n', 'utf8'); indexer.reindex();
  const flach = lies('Irgendwas', undefined, 'Flach.md');
  ok('Notiz ohne Ueberschriften: Fehler sagt das (und wie man sie liest)', flach.error === 'Abschnitt "Irgendwas" nicht gefunden in Flach.md. Die Notiz hat keine Ueberschriften – ohne section lesen (ggf. mit lines).', flach);

  // Viele Ueberschriften: Liste wird in der Tiefe reduziert statt mittendrin abgeschnitten
  const viele = [];
  for (let k = 1; k <= 10; k++) { viele.push('# Kapitel ' + k, ''); for (let u = 1; u <= 9; u++) viele.push('## K' + k + ' Teil ' + u, '', 'Text.', ''); }
  writeFileSync(join(vaultDir, 'Gross.md'), viele.join('\n'), 'utf8'); indexer.reindex();
  const gross = lies('Gibt es nicht', undefined, 'Gross.md');
  const grossListe = gross.error.split('\n').slice(1);
  ok(`100 Ueberschriften: hoechstens ${SECTION_LISTE_MAX} gelistet, nur die obere Ebene`, grossListe.length === 10 && grossListe.every(z => /^# Kapitel \d+$/.test(z)), grossListe.length);
  ok('100 Ueberschriften: Kopfzeile nennt Gesamtzahl und verweist auf outline', gross.error.includes('Vorhandene Ueberschriften (100; nur bis Ebene 1, 90 tiefere nicht gezeigt – outline zeigt alle):'), gross.error.slice(0, 200));
  ok('ueberschriftenListe: genau am Deckel bleibt alles drin', ueberschriftenListe(Array.from({ length: SECTION_LISTE_MAX }, (_, k) => ({ level: 2, text: 'T' + k }))).zeilen.length === SECTION_LISTE_MAX);
  const nurFlach = ueberschriftenListe(Array.from({ length: SECTION_LISTE_MAX + 15 }, (_, k) => ({ level: 2, text: 'T' + k })));
  ok('ueberschriftenListe: zu viele auf einer Ebene -> die ersten, mit Hinweis', nurFlach.zeilen.length === SECTION_LISTE_MAX && /nur die ersten 60 von 75/.test(nurFlach.hinweis), nurFlach.hinweis);

  // Notiz, die (noch) nicht im Index steht: Abschnitt direkt aus dem Inhalt
  writeFileSync(join(vaultDir, 'Frisch.md'), '# Frisch\n\n## A\n\neins\n\n## B\n\nzwei\n', 'utf8');
  ok('nicht indexierte Notiz: Abschnitt wird trotzdem gefunden', lies('B', undefined, 'Frisch.md').content === '## B\n\nzwei', lies('B', undefined, 'Frisch.md'));
  ok('nicht indexierte Notiz: unbekannter Abschnitt listet ihre Ueberschriften', (lies('Xyz', undefined, 'Frisch.md').error || '').endsWith('(3):\n# Frisch\n## A\n## B'), lies('Xyz', undefined, 'Frisch.md'));

  const win = lies('Eins', undefined, 'Win.md');
  ok('CRLF-Datei: Abschnitt endet richtig, kein \\r am Ende', win.content === '## Eins\r\n\r\nerste Zeile\r\nzweite Zeile' && win.sectionLines === 4, JSON.stringify(win.content));

  // Datei am Nexus vorbei geaendert (kein Watcher im Test): die Zeilennummern im Index stimmen nicht mehr.
  writeFileSync(join(vaultDir, 'Win.md'), '# Win\n\nNeu davor 1\nNeu davor 2\nNeu davor 3\n\n## Eins\n\nerste Zeile\n\n## Zwei\n\nzwei geaendert.\n\n## Drei\n\nganz neu.\n', 'utf8');
  const veraltet = lies('Zwei', undefined, 'Win.md');
  ok('veralteter Index: Abschnitt wird trotzdem richtig geliefert (Datei neu indexiert)', veraltet.content === '## Zwei\n\nzwei geaendert.', JSON.stringify(veraltet.content));
  ok('veralteter Index: neue Ueberschrift ist auffindbar', lies('Drei', undefined, 'Win.md').content === '## Drei\n\nganz neu.');

  console.log('\n── B. appendToSection ──');
  const ap = tools.appendToSection({ path: 'Plan.md', section: 'Setup', text: 'ANGEHAENGT' });
  const nachher = readFileSync(join(vaultDir, 'Plan.md'), 'utf8');
  const nachSetup = tools.readNote({ path: 'Plan.md', section: 'Setup' });
  ok('append "Setup" landet im Abschnitt Setup (nicht im Teiltreffer "Vor-Setup")', ap.ok === true && nachSetup.content.endsWith('ANGEHAENGT') && !tools.readNote({ path: 'Plan.md', section: 'Vor-Setup' }).content.includes('ANGEHAENGT'), nachSetup.content);
  ok('append steht am Abschnittsende, direkt vor der naechsten Ueberschrift gleicher Ebene', nachher.includes('ganz tief.\n\n\nANGEHAENGT\n## 🔒 12. Sicherheit'), nachher.slice(nachher.indexOf('ganz tief'), nachher.indexOf('ganz tief') + 60));

  console.log('\n── C. MCP read_note ──');
  const registry = { get: () => ({ vault: { name: 'vault', path: vaultDir }, tools }), list: () => ({ activeVault: 'vault', vaults: [] }), config: () => ({}) };
  const [c, s] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'read-section-test', version: '0.0.0' });
  await Promise.all([buildServer({ registry }).connect(s), client.connect(c)]);
  const mcp = async (args) => { const r = await client.callTool({ name: 'read_note', arguments: { path: 'Plan.md', ...args } }); return { err: r.isError === true, text: r.content?.[0]?.text ?? '' }; };

  const mSetup = await mcp({ section: 'Vor-Setup' });
  ok('normaler Abschnitt: nur der Text, kein Hinweis', !mSetup.err && mSetup.text === '## Vor-Setup\n\nDas kommt VOR dem Setup.', mSetup.text);
  const mLang = await mcp({ section: 'Lang' });
  ok('gekuerzter Abschnitt: Hinweis am Ende nennt Umfang und den naechsten Schritt',
    mLang.text.includes(`Langzeile ${SECTION_MAX_LINES - 2}`) && !mLang.text.includes(`Langzeile ${SECTION_MAX_LINES - 1}\n`) &&
    mLang.text.endsWith(`[gekuerzt: ${SECTION_MAX_LINES} von 302 Zeilen des Abschnitts "Lang" – mehr mit lines=302 oder ueber einen Unterabschnitt (outline).]`), mLang.text.slice(-200));
  const mLang302 = await mcp({ section: 'Lang', lines: 302 });
  ok('Nachfordern mit dem genannten lines liefert den ganzen Abschnitt ohne Hinweis', mLang302.text.endsWith('Langzeile 300'), mLang302.text.slice(-60));
  const mFehlt = await mcp({ section: 'Gibt es nicht' });
  ok('unbekannter Abschnitt: isError mit Ueberschriftenliste, kein Notiztext', mFehlt.err && mFehlt.text.startsWith('Abschnitt "Gibt es nicht" nicht gefunden in Plan.md. Vorhandene Ueberschriften (') &&
    mFehlt.text.includes('\n## Vor-Setup\n') && !mFehlt.text.includes('Das kommt VOR dem Setup') && !mFehlt.text.includes('Langzeile'), mFehlt.text.slice(0, 200));
  const mKorrigiert = await mcp({ section: mFehlt.text.split('\n')[2] });
  ok('eine Zeile aus der Fehlerliste fuehrt direkt zum Abschnitt', !mKorrigiert.err && mKorrigiert.text.startsWith('## Vor-Setup'), mKorrigiert.text.slice(0, 60));
  const mZeilen = await mcp({ lines: 4 });
  ok('lines ohne section: Kuerzung wird gemeldet', mZeilen.text.startsWith('---\ntitle: Plan\n---\n# Plan\n\n[gekuerzt: 4 von '), mZeilen.text.slice(0, 120));
  const mGanz = await mcp({});
  ok('ganze Notiz: unveraendert, kein Hinweis', mGanz.text === readFileSync(join(vaultDir, 'Plan.md'), 'utf8'));
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
