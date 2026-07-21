// test/vortrag.test.mjs – R24: pure Logik des Vortragsskripts.
// Teil A: vortragNorm/validateVortragSegmente aus src/tools.js (deterministisch, ohne FS/DB).
// Teil B: Paritaet mit der UI-Seite – vtNorm aus public/index.html (Marker
//         //__VT_START__/__VT_END__, data:-URL-Import wie test/live-preview.test.mjs)
//         MUSS sich identisch zu vortragNorm verhalten, sonst findet der Player
//         Anker nicht, die write_vortrag serverseitig fuer gueltig erklaert hat.
// Lauf: node test/vortrag.test.mjs
import { readFileSync } from 'fs';
import { vortragNorm, validateVortragSegmente, vortragSidecarPath, VORTRAG_ARTEN } from '../src/tools.js';

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, detail ? `(${detail})` : ''); fail++; }
}

console.log('\n── A1. vortragNorm: Roh-Markdown und Sichttext auf dieselbe Form ──');
ok('Inline-Marker mitten im Wort ersatzlos', vortragNorm('**Wort**mitte') === 'wortmitte', vortragNorm('**Wort**mitte'));
ok('Highlight ==x== ersatzlos', vortragNorm('==markiert==') === 'markiert');
ok('Inline-Code `x` ersatzlos', vortragNorm('ein `code`wort') === 'ein codewort');
ok('Wikilink mit Alias -> Alias', vortragNorm('siehe [[Ziel|Alias]]') === 'siehe alias');
ok('Wikilink ohne Alias -> Ziel', vortragNorm('[[Uni/Thermo]]') === 'uni/thermo');
ok('Wikilink mit Heading-Anker -> Ziel', vortragNorm('[[Datei#Abschnitt]]') === 'datei');
ok('MD-Link -> Linktext', vortragNorm('[Text](http://x.de)') === 'text');
ok('Ueberschrift: ## als Trenner', vortragNorm('## Titel') === 'titel');
ok('Tabellenzeile: Pipes als Trenner', vortragNorm('| a | b |') === 'a b');
ok('Zitat: > als Trenner', vortragNorm('> Zitat') === 'zitat');
ok('Bild-Syntax verschwindet', vortragNorm('![alt](url) Text') === 'text');
ok('Embed-Syntax verschwindet', vortragNorm('![[Bild.png]] Text') === 'text');
ok('Whitespace kollabiert + lowercase', vortragNorm('  A \t  B ') === 'a b');
ok('Leer/undefined -> ""', vortragNorm() === '' && vortragNorm('') === '');
ok('NFC-Normalisierung: NFD-Umlaut == NFC-Umlaut', vortragNorm('Wärme') === vortragNorm('Wärme'), JSON.stringify([vortragNorm('Wärme'),vortragNorm('Wärme')]));

console.log('\n── A2. Containment: Klartext-Anker findet dekorierten Rohtext ──');
const roh = [
  '---', 'title: Demo', '---',
  '# Thermodynamik',
  'Der **erste Hauptsatz** lautet: dU = deltaQ minus deltaW.',
  '> [!tip] Erklärung',
  '> Energie geht [[Physik/Energie|nie verloren]].',
  '| Größe | Symbol |', '|---|---|', '| Wärme | Q |',
].join('\n');
const nroh = vortragNorm(roh);
ok('Anker "erste Hauptsatz" (plain) in fettem Rohtext', nroh.includes(vortragNorm('erste Hauptsatz')));
ok('Anker mit Satzzeichen: "dU = deltaQ minus deltaW"', nroh.includes(vortragNorm('dU = deltaQ minus deltaW')));
ok('Anker ueber Alias-Wikilink: "nie verloren"', nroh.includes(vortragNorm('nie verloren')));
ok('Anker in Tabellenzelle: "Wärme"', nroh.includes(vortragNorm('Wärme')));
ok('Nicht vorhandenes ist nicht enthalten', !nroh.includes(vortragNorm('Quantenfeldtheorie')));

console.log('\n── A3. validateVortragSegmente ──');
ok('leeres Array -> Fehler', validateVortragSegmente([], roh).length === 1);
ok('kein Array -> Fehler', validateVortragSegmente(null, roh).length === 1);
ok('gueltig: anker + default art', validateVortragSegmente([{ sprich: 'Hallo', anker: 'erste Hauptsatz' }], roh).length === 0);
ok('gueltig: art keine ohne anker', validateVortragSegmente([{ sprich: 'Intro', art: 'keine' }], roh).length === 0);
ok('gueltig: ohne art, ohne anker -> implizit keine', validateVortragSegmente([{ sprich: 'Intro' }], roh).length === 0);
const e1 = validateVortragSegmente([{ sprich: '   ' }], roh);
ok('leeres sprich -> Fehler nennt Segment 1', e1.length === 1 && e1[0].includes('Segment 1'), e1.join(';'));
const e2 = validateVortragSegmente([{ sprich: 'x', art: 'blinken' }], roh);
ok('unbekannte art -> Fehler mit erlaubten Werten', e2.length === 1 && e2[0].includes('blinken') && VORTRAG_ARTEN.every(a => e2[0].includes(a)), e2.join(';'));
const e3 = validateVortragSegmente([{ sprich: 'x', anker: 'GIBT ES NICHT XYZ' }], roh);
ok('anker nicht gefunden -> Fehler zitiert anker', e3.length === 1 && e3[0].includes('GIBT ES NICHT XYZ'), e3.join(';'));
const e4 = validateVortragSegmente([{ sprich: 'x', art: 'wort' }], roh);
ok('art!=keine ohne anker -> Fehler', e4.length === 1 && e4[0].includes('anker'), e4.join(';'));
const e5 = validateVortragSegmente([
  { sprich: 'ok', anker: 'erste Hauptsatz' },
  { sprich: '', anker: 'x' },
  { sprich: 'y', anker: 'FEHLT_99' },
], roh);
ok('mehrere Fehler werden alle gemeldet', e5.length === 2 && e5[0].includes('Segment 2') && e5[1].includes('Segment 3'), e5.join(';'));
const e6 = validateVortragSegmente([{ sprich: 'x', anker: '**' }], roh);
ok('nur-Marker-anker ("**") -> Fehler statt stilles Durchrutschen', e6.length === 1 && e6[0].includes('Markdown-Markern'), e6.join(';'));
const e7 = validateVortragSegmente([{ sprich: 'S'.repeat(2001), anker: 'erste Hauptsatz' }], roh);
ok('sprich > 2000 Zeichen -> Fehler', e7.length === 1 && e7[0].includes('zu lang'), e7.join(';'));
const e8 = validateVortragSegmente([{ sprich: 'x', anker: 'A'.repeat(401) }], roh);
ok('anker > 400 Zeichen -> Fehler', e8.length === 1 && e8[0].includes('zu lang'), e8.join(';'));
const e9 = validateVortragSegmente(Array.from({ length: 201 }, () => ({ sprich: 'x', art: 'keine' })), roh);
ok('mehr als 200 Segmente -> Fehler', e9.length === 1 && e9[0].includes('zu viele'), e9.join(';'));

console.log('\n── A4. vortragSidecarPath ──');
ok('Uni/A.md -> Uni/A.vortrag.json', vortragSidecarPath('Uni/A.md') === 'Uni/A.vortrag.json');
ok('case-insensitiv (.MD)', vortragSidecarPath('B.MD') === 'B.vortrag.json');

console.log('\n── B. Paritaet UI (vtNorm) <-> Server (vortragNorm) ──');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const a = html.indexOf('//__VT_START__');
const b = html.indexOf('//__VT_END__');
ok('VT-Marker in index.html vorhanden', a !== -1 && b !== -1 && b > a, `a=${a} b=${b}`);
if (a !== -1 && b !== -1 && b > a) {
  const core = html.slice(a, b);
  const mod = await import('data:text/javascript,' + encodeURIComponent(core + '\nexport {vtNorm, vtChunkSaetze, vtSprechtext};'));
  const corpus = [
    '**Wort**mitte', '==markiert==', 'ein `code`wort',
    'siehe [[Ziel|Alias]]', '[[Uni/Thermo]]', '[[Datei#Abschnitt]]', '[Text](http://x.de)',
    '## Titel', '| a | b |', '> Zitat', '![alt](url) Text', '![[Bild.png]] Text',
    '  A \t  B ', '', 'Der **erste Hauptsatz** lautet: dU = deltaQ minus deltaW.',
    'Wärme & Größen – ÄÖÜß', '- [ ] offener Punkt', '1. nummeriert',
  ];
  let same = true, diff = '';
  for (const s of corpus) {
    if (mod.vtNorm(s) !== vortragNorm(s)) { same = false; diff = `"${s}": ui="${mod.vtNorm(s)}" srv="${vortragNorm(s)}"`; break; }
  }
  ok('vtNorm(x) === vortragNorm(x) fuer gesamten Korpus', same, diff);

  // vtChunkSaetze: lange Absaetze in sprechbare Stuecke teilen (Chromium-TTS
  // kappt sehr lange Utterances) – Saetze bleiben ganz, Reihenfolge erhalten.
  const langerText = 'Erster Satz. Zweiter Satz! Dritter Satz? ' + 'Sehr langer vierter Satz ohne Ende '.repeat(20).trim() + '.';
  const chunks = mod.vtChunkSaetze(langerText, 180);
  ok('vtChunkSaetze: zerteilt langen Text', chunks.length >= 2, `chunks=${chunks.length}`);
  ok('vtChunkSaetze: nichts geht verloren', chunks.join(' ').replace(/\s+/g, ' ') === langerText.replace(/\s+/g, ' '));
  ok('vtChunkSaetze: kurzer Text bleibt EIN Chunk', mod.vtChunkSaetze('Kurz und gut.', 180).length === 1);
  ok('vtChunkSaetze: leer -> []', mod.vtChunkSaetze('', 180).length === 0);

  // vtSprechtext: Block-Typ -> gesprochener Text (linearer Fallback-Modus)
  ok('vtSprechtext: Tabelle wird angesagt, nicht vorgelesen',
     mod.vtSprechtext('tabelle', 'Größe Symbol Wärme Q', { spalten: 2, zeilen: 1 }).includes('Tabelle'),
     mod.vtSprechtext('tabelle', 'x', { spalten: 2, zeilen: 1 }));
  ok('vtSprechtext: Codeblock wird uebersprungen-Ansage',
     mod.vtSprechtext('code', 'const x=1', { zeilen: 3 }).toLowerCase().includes('code'));
  ok('vtSprechtext: Absatz gibt Text unveraendert', mod.vtSprechtext('absatz', 'Hallo Welt.', {}) === 'Hallo Welt.');
}

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
