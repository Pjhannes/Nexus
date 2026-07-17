// test/live-preview.test.mjs – Verifiziert den Live-Preview-Kern (R22 Phase 1) aus public/index.html.
// Der Kern ist DOM- und CodeMirror-frei zwischen den Markern //__LP_START__ und //__LP_END__
// gekapselt (gleiches Muster wie der Markdown-Renderer, //__MD_START__).
// Lauf: node test/live-preview.test.mjs
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, '..', 'public', 'index.html'), 'utf8');
const a = html.indexOf('//__LP_START__');
const b = html.indexOf('//__LP_END__');
if (a < 0 || b < 0) { console.error('Marker //__LP_START__/__LP_END__ nicht gefunden'); process.exit(1); }
const core = html.slice(a, b);

const mod = await import('data:text/javascript,' + encodeURIComponent(core + '\nexport {lpBuild,LP_HIDE,LP_MARK,LP_LINE};'));
const { lpBuild, LP_HIDE } = mod;

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else { console.log('  \x1b[31m✗\x1b[0m', label, detail !== undefined ? '\n      → ' + JSON.stringify(detail) : ''); fail++; }
}

// ── doc-Stub: exakt die zwei Methoden, die lpBuild von CM6s Text braucht ──────
function mkDoc(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return {
    sliceString: (from, to) => text.slice(from, to),
    lineAt(pos) {
      let i = 0; while (i + 1 < starts.length && starts[i + 1] <= pos) i++;
      const from = starts[i];
      const nl = text.indexOf('\n', from);
      return { from, to: nl < 0 ? text.length : nl, number: i + 1 };
    },
  };
}
// Bequemer Token-Bauer: findet das n-te Vorkommen von `str`
const tok = (text, name, str, nth = 1, parent = null) => {
  let idx = -1; for (let i = 0; i < nth; i++) idx = text.indexOf(str, idx + 1);
  if (idx < 0) throw new Error(`Token "${str}" (#${nth}) nicht in Text`);
  return { name, from: idx, to: idx + str.length, parent };
};
const hidden = (doc, r) => r.hide.map(h => doc.sliceString(h.from, h.to));
const sichtbar = (text, r) => {
  let out = '', i = 0;
  const sorted = [...r.hide].sort((x, y) => x.from - y.from);
  for (const h of sorted) { out += text.slice(i, h.from); i = h.to; }
  return out + text.slice(i);
};

console.log('\nLive-Preview-Kern (R22 Phase 1)\n');

// ── 1) Fett: Marker verschwinden, Inhalt wird markiert ───────────────────────
{
  const t = 'Das ist **fett** hier';
  const doc = mkDoc(t);
  const r = lpBuild(doc, [
    { name: 'StrongEmphasis', from: 8, to: 16 },
    tok(t, 'EmphasisMark', '**', 1), tok(t, 'EmphasisMark', '**', 2),
  ], []);
  ok('**fett** – beide Marker versteckt', r.hide.length === 2 && hidden(doc, r).every(x => x === '**'), hidden(doc, r));
  ok('**fett** – sichtbar bleibt "Das ist fett hier"', sichtbar(t, r) === 'Das ist fett hier', sichtbar(t, r));
  ok('**fett** – Inhalt als lp-strong markiert', r.marks.length === 1 && r.marks[0].cls === 'lp-strong');
}

// ── 2) Cursor in der Zeile -> Rohsyntax (das Kernverhalten) ──────────────────
{
  const t = 'Das ist **fett** hier';
  const doc = mkDoc(t);
  const toks = [{ name: 'StrongEmphasis', from: 8, to: 16 }, tok(t, 'EmphasisMark', '**', 1), tok(t, 'EmphasisMark', '**', 2)];
  const r = lpBuild(doc, toks, [{ from: 0, to: t.length }]);
  ok('Reveal: Cursor in der Zeile -> nichts versteckt', r.hide.length === 0, r.hide);
  ok('Reveal: Styling bleibt trotzdem', r.marks.length === 1 && r.marks[0].cls === 'lp-strong');
}

// ── 3) Reveal gilt NUR fuer die Selektionszeile, nicht fuer die Nachbarn ─────
{
  const t = '**eins**\n**zwei**\n**drei**';
  const doc = mkDoc(t);
  const toks = [];
  for (let i = 1; i <= 3; i++) toks.push({ name: 'EmphasisMark', from: t.indexOf('**', (i - 1) * 9), to: t.indexOf('**', (i - 1) * 9) + 2 });
  // Zeile 2 = Zeichen 9..17
  const z2 = doc.lineAt(10);
  const r = lpBuild(doc, [
    { name: 'EmphasisMark', from: 0, to: 2 }, { name: 'EmphasisMark', from: 6, to: 8 },
    { name: 'EmphasisMark', from: 9, to: 11 }, { name: 'EmphasisMark', from: 15, to: 17 },
    { name: 'EmphasisMark', from: 18, to: 20 }, { name: 'EmphasisMark', from: 24, to: 26 },
  ], [{ from: z2.from, to: z2.to }]);
  ok('Reveal: nur Zeile 2 zeigt Rohsyntax (4 von 6 Markern weg)', r.hide.length === 4, r.hide);
  ok('Reveal: Zeile-2-Marker bleiben sichtbar', !r.hide.some(h => h.from >= 9 && h.to <= 17), r.hide);
}

// ── 4) Ueberschrift: "## " inkl. Leerzeichen weg, Zeilenklasse gesetzt ───────
{
  const t = '## Titel hier';
  const doc = mkDoc(t);
  const r = lpBuild(doc, [{ name: 'ATXHeading2', from: 0, to: t.length }, { name: 'HeaderMark', from: 0, to: 2 }], []);
  ok('## – Zeilenklasse lp-h2', r.lines.length === 1 && r.lines[0].cls === 'lp-h2' && r.lines[0].from === 0);
  ok('## – Marker UND Leerzeichen versteckt (kein Einzug)', sichtbar(t, r) === 'Titel hier', sichtbar(t, r));
}

// ── 5) Leeres "#" am Zeilenende: darf nicht ueber den Umbruch hinaus fressen ─
{
  const t = '#\nnaechste Zeile';
  const doc = mkDoc(t);
  const r = lpBuild(doc, [{ name: 'ATXHeading1', from: 0, to: 1 }, { name: 'HeaderMark', from: 0, to: 1 }], []);
  ok('"#" allein – frisst den Zeilenumbruch NICHT', r.hide[0].to === 1, r.hide);
  ok('"#" allein – naechste Zeile unversehrt', sichtbar(t, r) === '\nnaechste Zeile', JSON.stringify(sichtbar(t, r)));
}

// ── 6) Link: Klammern + URL weg, nur der Text bleibt ────────────────────────
{
  const t = 'siehe [Doku](https://x.de) dort';
  const doc = mkDoc(t);
  // Offsets aus dem String rechnen statt abzaehlen – von Hand hatte ich mich hier verzaehlt.
  const at = (str, nth = 1) => { let i = -1; for (let k = 0; k < nth; k++) i = t.indexOf(str, i + 1); return i; };
  const span = (str, nth = 1) => ({ from: at(str, nth), to: at(str, nth) + str.length });
  const r = lpBuild(doc, [
    { name: 'Link', ...{ from: at('['), to: at(')') + 1 } },
    { name: 'LinkMark', ...span('['), parent: 'Link' },
    { name: 'LinkMark', ...span(']'), parent: 'Link' },
    { name: 'LinkMark', ...span('('), parent: 'Link' },
    { name: 'URL', ...span('https://x.de'), parent: 'Link' },
    { name: 'LinkMark', ...span(')'), parent: 'Link' },
  ], []);
  ok('[Doku](url) – sichtbar bleibt nur "siehe Doku dort"', sichtbar(t, r) === 'siehe Doku dort', sichtbar(t, r));
  ok('[Doku](url) – Link als lp-link markiert', r.marks.some(m => m.cls === 'lp-link'));
}

// ── 7) Verschachtelt: **fett *kursiv* ** ────────────────────────────────────
{
  const t = '**fett *kursiv* zu**';
  const doc = mkDoc(t);
  const r = lpBuild(doc, [
    { name: 'StrongEmphasis', from: 0, to: 20 },
    { name: 'EmphasisMark', from: 0, to: 2 },
    { name: 'Emphasis', from: 7, to: 15 },
    { name: 'EmphasisMark', from: 7, to: 8 },
    { name: 'EmphasisMark', from: 14, to: 15 },
    { name: 'EmphasisMark', from: 18, to: 20 },
  ], []);
  ok('verschachtelt – alle 4 Marker weg', r.hide.length === 4, r.hide);
  ok('verschachtelt – sichtbar "fett kursiv zu"', sichtbar(t, r) === 'fett kursiv zu', sichtbar(t, r));
  ok('verschachtelt – lp-strong UND lp-em', r.marks.some(m => m.cls === 'lp-strong') && r.marks.some(m => m.cls === 'lp-em'));
}

// ── 8) Inline-Code ──────────────────────────────────────────────────────────
{
  const t = 'nutze `npm run x` dafuer';
  const doc = mkDoc(t);
  const r = lpBuild(doc, [
    { name: 'InlineCode', from: 6, to: 17 },
    { name: 'CodeMark', from: 6, to: 7 }, { name: 'CodeMark', from: 16, to: 17 },
  ], []);
  ok('`code` – Backticks weg, lp-code gesetzt', sichtbar(t, r) === 'nutze npm run x dafuer' && r.marks[0].cls === 'lp-code', sichtbar(t, r));
}

// ── 9) Zitat: "> " weg, Zeilenklasse je Zeile ──────────────────────────────
{
  const t = '> erste\n> zweite';
  const doc = mkDoc(t);
  const r = lpBuild(doc, [
    { name: 'Blockquote', from: 0, to: 16 },
    { name: 'QuoteMark', from: 0, to: 1 }, { name: 'QuoteMark', from: 8, to: 9 },
  ], []);
  ok('Zitat – beide Zeilen bekommen lp-quote', r.lines.length === 2 && r.lines.every(l => l.cls === 'lp-quote'), r.lines);
  ok('Zitat – "> " inkl. Leerzeichen weg', sichtbar(t, r) === 'erste\nzweite', JSON.stringify(sichtbar(t, r)));
}

// ── 10) Marker an Wortgrenzen: snake_case darf NICHT kursiv werden ─────────
// (Lezer liefert dafuer gar keine Emphasis-Knoten – der Kern darf nichts erfinden.)
{
  const t = 'ein_wort_mit_unterstrichen';
  const doc = mkDoc(t);
  const r = lpBuild(doc, [], []);
  ok('snake_case – keine Token, also nichts versteckt', r.hide.length === 0 && r.marks.length === 0);
  ok('snake_case – Text unveraendert', sichtbar(t, r) === t);
}

// ── 11) Codeblock: Marker INNERHALB bleiben stehen (kein Emphasis-Knoten) ──
{
  const t = '```\nlet a = **b**;\n```';
  const doc = mkDoc(t);
  // In einem FencedCode liefert Lezer keine Emphasis-Knoten -> nichts zu verstecken.
  const r = lpBuild(doc, [{ name: 'FencedCode', from: 0, to: t.length }], []);
  ok('Codeblock – "**b**" bleibt woertlich stehen', sichtbar(t, r) === t, sichtbar(t, r));
}

// ── 12) Unbekannte Knoten werden ignoriert (Robustheit) ───────────────────
{
  const t = 'irgendwas';
  const r = lpBuild(mkDoc(t), [{ name: 'GibtsNicht', from: 0, to: 9 }, { name: 'Document', from: 0, to: 9 }], []);
  ok('unbekannte Knoten – nichts versteckt, kein Absturz', r.hide.length === 0 && r.marks.length === 0 && r.lines.length === 0);
}

// ── 13) ListMark bleibt bewusst sichtbar (Phase 1 hat keine Bullet-Widgets) ─
{
  ok('ListMark steht NICHT auf der Verstecken-Liste (braucht ein Widget, Phase 2)', !LP_HIDE.has('ListMark'));
  const t = '- ein Punkt';
  const r = lpBuild(mkDoc(t), [{ name: 'ListMark', from: 0, to: 1 }], []);
  ok('ListMark – "-" bleibt sichtbar', sichtbar(t, r) === t, sichtbar(t, r));
}

// ── 14) Mehrfachselektion: alle betroffenen Zeilen zeigen Rohsyntax ────────
{
  const t = '**a**\n**b**\n**c**';
  const doc = mkDoc(t);
  const toks = [
    { name: 'EmphasisMark', from: 0, to: 2 }, { name: 'EmphasisMark', from: 3, to: 5 },
    { name: 'EmphasisMark', from: 6, to: 8 }, { name: 'EmphasisMark', from: 9, to: 11 },
    { name: 'EmphasisMark', from: 12, to: 14 }, { name: 'EmphasisMark', from: 15, to: 17 },
  ];
  const r = lpBuild(doc, toks, [{ from: 0, to: 5 }, { from: 12, to: 17 }]);
  ok('Mehrfachselektion – Zeile 1 und 3 roh, nur Zeile 2 versteckt', r.hide.length === 2 && r.hide.every(h => h.from >= 6 && h.to <= 11), r.hide);
}

console.log(`\n${pass} ok, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
