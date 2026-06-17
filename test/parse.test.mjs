// test/parse.test.mjs – Verifiziert die Wikilink-Extraktion aus src/parse.js.
// Deckt die zwei Session-49-Bugs ab: escapte Tabellen-Pipes "\|" + Links in Code.
// Lauf: node test/parse.test.mjs   (aus D:\Nexus bzw. /tmp-Kopie in der Sandbox)
import { parseNote, extractLinks } from '../src/parse.js';

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label); fail++; }
}
const targets = (md) => parseNote(md).links.map(l => l.target);

// ── BUG 1: escapte Tabellen-Pipe "\|" landet NICHT mehr im Ziel ──
{
  const l = parseNote('[[A\\|B]]').links;
  ok('Escapter Pipe \\|: target == A', l[0]?.target === 'A');
  ok('Escapter Pipe \\|: alias == B',  l[0]?.alias === 'B');
}
{
  const l = parseNote('| Spalte | [[02 – Berufliche Fähigkeiten\\|P/02]] |').links;
  ok('Tabellen-Link: target ohne trailing Backslash', l[0]?.target === '02 – Berufliche Fähigkeiten');
  ok('Tabellen-Link: alias == P/02', l[0]?.alias === 'P/02');
}

// ── Heading-Anker (#...) wird abgetrennt ──
{
  const l = parseNote('[[A#h|B]]').links;
  ok('Heading+Alias [[A#h|B]]: target == A', l[0]?.target === 'A');
  ok('Heading+Alias [[A#h|B]]: alias == B',  l[0]?.alias === 'B');
}
ok('Heading ohne Alias [[A#h]]: target == A', targets('[[A#h]]')[0] === 'A');

// ── normaler Pipe-Alias + nackter Link ──
{
  const l = parseNote('[[Controlling|Buchhaltung]] und [[Fehlt]]').links;
  ok('Normaler Alias: target == Controlling', l[0]?.target === 'Controlling');
  ok('Normaler Alias: alias == Buchhaltung',  l[0]?.alias === 'Buchhaltung');
  ok('Nackter Link [[Fehlt]]: target == Fehlt', l[1]?.target === 'Fehlt');
  ok('Nackter Link [[Fehlt]]: alias == null',   l[1]?.alias === null);
}

// ── BUG 2: Links in Code werden NICHT indiziert (wie Obsidian) ──
ok('Inline-Code `[[X]]` -> kein Link', targets('Beispiel: `search { q: "[[X]]" }`').length === 0);
ok('Fenced-Code ``` [[Y]] -> kein Link',
   targets(['Text', '```', 'siehe [[Y]]', '```'].join('\n')).length === 0);
ok('Tilde-Fence ~~~ [[Z]] -> kein Link',
   targets(['~~~', '[[Z]]', '~~~'].join('\n')).length === 0);
{
  // Echter Link ausserhalb + Beispiel-Link innerhalb von Code: nur der echte zaehlt.
  const t = targets('Echt: [[Real]]\n\n```\nnur Beispiel [[Fake]]\n```');
  ok('Code mischt nicht: nur [[Real]] indiziert', t.length === 1 && t[0] === 'Real');
}

// ── externe Links (http/https) werden gefiltert ──
ok('http(s)-Wikilink wird ignoriert', targets('[[https://example.com]]').length === 0);

// ── extractLinks direkt aufrufbar (gemeinsamer Helper) ──
ok('extractLinks() direkt: code-frei + normalisiert',
   extractLinks('[[A\\|B]] `[[Skip]]`').length === 1 && extractLinks('[[A\\|B]] `[[Skip]]`')[0].target === 'A');

// ── Mehrere Links pro Zeile / Reihenfolge ──
ok('Mehrere Links je Zeile in Reihenfolge',
   targets('[[Eins]] [[Zwei]] [[Drei]]').join(',') === 'Eins,Zwei,Drei');

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
