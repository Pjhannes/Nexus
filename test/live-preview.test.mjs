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

const mod = await import('data:text/javascript,' + encodeURIComponent(core + '\nexport {lpBuild,LP_HIDE,LP_MARK,LP_LINE,lpNorm,lpLineForText,lpBlockForLine,lpScanLine,lpFrontmatterEnd,lpPropsWidget};'));
const { lpBuild, LP_HIDE, lpNorm, lpLineForText, lpBlockForLine, lpScanLine, lpFrontmatterEnd, lpPropsWidget } = mod;

// Stub fuer stripInline. WICHTIG: bildet die ECHTE Funktion nach, die NUR Inline-Markdown
// entfernt – Block-Marker ("## ", "> ", "- ") bleiben stehen. Ein frueherer Stub entfernte sie
// auch und war damit maechtiger als das Original: die Tests waren gruen, live fand der Anker
// keine einzige Ueberschrift. Block-Marker abzuraeumen ist Aufgabe von lpStripBlock().
// Der abschliessende /[*_~`=]/-Sweep MUSS mit dabei sein: das echte stripInline entfernt
// diese Marker roh (Zeile "return …replace(/[*_~`=]/g,'')"). Ohne ihn war der Stub schwaecher
// als das Original – ein literaler "_" (Wikilink-Ziel, snake_case) blieb im Stub stehen, sodass
// Anker- und Quelltext scheinbar passten. Genau diese Luecke liess den Unterstrich-Bug live
// durchrutschen, obwohl die Suite gruen war (Regressionstest 18e unten).
const strip = (l) => l
  .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
  .replace(/`(.+?)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1')
  .replace(/\[\[(.+?)\]\]/g, '$1')
  .replace(/[*_~`=]/g, '');

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

// ── 13) ListMark: seit E4a Bullet-WIDGET statt hide (Phase 2 der Roadmap) ──
{
  ok('ListMark steht NICHT auf der Verstecken-Liste (er wird ein Widget, E4a)', !LP_HIDE.has('ListMark'));
  const t = '- ein Punkt';
  const r = lpBuild(mkDoc(t), [{ name: 'ListMark', from: 0, to: 1 }], []);
  ok('ListMark – kein hide, dafuer 1 Bullet-Widget {0,1}',
    r.hide.length === 0 && r.widgets.length === 1 && r.widgets[0].type === 'bullet' && r.widgets[0].from === 0 && r.widgets[0].to === 1, r.widgets);
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

// ═══ E1: Reveal pro KONSTRUKT statt pro Zeile (Paul, 2026-07-19: "Extrazeichen erst,
//     wenn ich mit dem Cursor auf diesen Bereich gehe oder auf dieses Wort") ═══
// Inline-Marker tragen jetzt die Range ihres Eltern-Konstrukts (parentFrom/To); lpBuild
// revealt sie nur, wenn die Selektion DIESE Range beruehrt. Zeilen-Marker (##, >) behalten
// den Zeilen-Kontext. Das ViewPlugin liefert die Selektion seit E1 ROH (Punkt-Ranges).
console.log('\nE1 – Konstrukt-Reveal\n');

// Helfer: Marker-Token MIT Eltern-Range (wie das ViewPlugin sie seit E1 liefert).
const mtok = (name, from, to, parent, pf, pt) => ({ name, from, to, parent, parentFrom: pf, parentTo: pt });

// ── 24) Kernfall: Cursor IM Konstrukt -> nur DESSEN Marker erscheinen ─────
{
  const t = 'Ein **fett** und *kursiv* dazu';   // fett: 4-12, kursiv: 17-25
  const doc = mkDoc(t);
  const toks = [
    { name: 'StrongEmphasis', from: 4, to: 12 },
    mtok('EmphasisMark', 4, 6, 'StrongEmphasis', 4, 12), mtok('EmphasisMark', 10, 12, 'StrongEmphasis', 4, 12),
    { name: 'Emphasis', from: 17, to: 25 },
    mtok('EmphasisMark', 17, 18, 'Emphasis', 17, 25), mtok('EmphasisMark', 24, 25, 'Emphasis', 17, 25),
  ];
  const rIn = lpBuild(doc, toks, [{ from: 8, to: 8 }]);          // Cursor mitten in "fett"
  ok('E1: Cursor in **fett** -> dessen ** sichtbar', rIn.hide.every(h => h.from >= 17), rIn.hide);
  ok('E1: ...aber *kursiv* daneben bleibt zu', rIn.hide.length === 2, rIn.hide);
  const rOut = lpBuild(doc, toks, [{ from: 14, to: 14 }]);       // Cursor auf der Zeile, AUSSERHALB beider
  ok('E1: Cursor auf Zeile ausserhalb -> alle 4 Marker versteckt', rOut.hide.length === 4, rOut.hide);
}

// ── 25) Konstrukt-Grenzen: Cursor direkt vor/hinter dem Konstrukt revealt ──
// (lpRevealed nutzt <=/>=; wichtig beim Tippen: nach dem Schliessen von **fett** steht der
// Cursor hinter dem Marker und die Zeichen sollen noch sichtbar sein.)
{
  const t = '**fett**';
  const doc = mkDoc(t);
  const toks = [
    { name: 'StrongEmphasis', from: 0, to: 8 },
    mtok('EmphasisMark', 0, 2, 'StrongEmphasis', 0, 8), mtok('EmphasisMark', 6, 8, 'StrongEmphasis', 0, 8),
  ];
  ok('E1: Cursor an from-Grenze -> reveal', lpBuild(doc, toks, [{ from: 0, to: 0 }]).hide.length === 0);
  ok('E1: Cursor an to-Grenze -> reveal', lpBuild(doc, toks, [{ from: 8, to: 8 }]).hide.length === 0);
}

// ── 26) Zeilen-Marker behalten Zeilen-Kontext: ## zeigt sich bei Cursor irgendwo ──
{
  const t = '## Titel hier';
  const doc = mkDoc(t);
  // HeaderMark hat als Eltern die ATXHeading2-Range - der Kontext MUSS trotzdem die Zeile
  // sein (LP_LINE_MARK), sonst waere der Marker bei einem Cursor am Zeilenende unerreichbar,
  // wenn das Heading-Token enger gefasst ist.
  const toks = [mtok('HeaderMark', 0, 2, 'ATXHeading2', 0, 13)];
  ok('E1: Cursor am Zeilenende -> "## " sichtbar (Zeilen-Kontext)',
    lpBuild(doc, toks, [{ from: 13, to: 13 }]).hide.length === 0);
  ok('E1: ohne Cursor auf der Zeile -> "## " versteckt',
    lpBuild(doc, toks, []).hide.length === 1);
}

// ── 27) Link: Cursor im Linktext -> URL+Klammern erscheinen (Kontext = Link-Range) ──
{
  const t = 'Siehe [Text](https://x.de) dazu';  // Link: 6-26
  const doc = mkDoc(t);
  const toks = [
    { name: 'Link', from: 6, to: 26 },
    mtok('LinkMark', 6, 7, 'Link', 6, 26), mtok('LinkMark', 11, 12, 'Link', 6, 26),
    mtok('LinkMark', 12, 13, 'Link', 6, 26), mtok('LinkMark', 25, 26, 'Link', 6, 26),
    mtok('URL', 13, 25, 'Link', 6, 26),
  ];
  ok('E1: Cursor im Linktext -> nichts versteckt', lpBuild(doc, toks, [{ from: 9, to: 9 }]).hide.length === 0);
  ok('E1: Cursor hinter dem Link -> Marker+URL versteckt (5 Ranges)',
    lpBuild(doc, toks, [{ from: 29, to: 29 }]).hide.length === 5);
}

// ── 28) Tokens OHNE Eltern-Range (alte Aufrufer/Tests) -> Zeilen-Fallback ──
{
  const t = 'a **b** c';
  const doc = mkDoc(t);
  const toks = [{ name: 'EmphasisMark', from: 2, to: 4 }, { name: 'EmphasisMark', from: 5, to: 7 }];
  ok('E1: ohne parentFrom -> Reveal wie frueher zeilenweise',
    lpBuild(doc, toks, [{ from: 9, to: 9 }]).hide.length === 0);
}

// ═══ E4a: Widget-Schicht (Bullets, Checkboxen, HR) - reine Daten aus lpBuild ═══
console.log('\nE4a – Widgets\n');

// ── 29) Checkbox: ListMark + TaskMarker derselben Zeile -> EIN task-Widget ──
{
  const t = '- [x] erledigt hier\n- [ ] offen hier';
  const doc = mkDoc(t);
  const toks = [
    { name: 'ListMark', from: 0, to: 1 }, { name: 'TaskMarker', from: 2, to: 5 },
    { name: 'ListMark', from: 20, to: 21 }, { name: 'TaskMarker', from: 22, to: 25 },
  ];
  const r = lpBuild(doc, toks, []);
  ok('E4a: 2 task-Widgets, KEIN separates Bullet', r.widgets.length === 2 && r.widgets.every(w => w.type === 'task'), r.widgets);
  ok('E4a: Widget 1 spannt Bullet+Marker ({0,5}, checked)', r.widgets[0].from === 0 && r.widgets[0].to === 5 && r.widgets[0].data.checked === true, r.widgets[0]);
  ok('E4a: Widget 2 unchecked', r.widgets[1].data.checked === false, r.widgets[1]);
  ok('E4a: nur die erledigte Zeile bekommt lp-task-done', r.lines.length === 1 && r.lines[0].cls === 'lp-task-done' && r.lines[0].from === 0, r.lines);
}

// ── 30) Nummerierte Liste: "1." bleibt sichtbar (kein Widget, wie Obsidian) ──
{
  const t = '1. erster';
  const r = lpBuild(mkDoc(t), [{ name: 'ListMark', from: 0, to: 2 }], []);
  ok('E4a: "1." -> kein Widget', r.widgets.length === 0, r.widgets);
}

// ── 31) HR: die "---"-Zeile wird ein hr-Widget ────────────────────────────
{
  const t = 'davor\n\n---\n\ndanach';
  const r = lpBuild(mkDoc(t), [{ name: 'HorizontalRule', from: 7, to: 10 }], []);
  ok('E4a: HR-Widget {7,10}', r.widgets.length === 1 && r.widgets[0].type === 'hr' && r.widgets[0].from === 7 && r.widgets[0].to === 10, r.widgets);
}

// ── 32) Reveal unterdrueckt das Widget: Cursor auf der Zeile -> Rohtext ────
{
  const t = '- [x] erledigt hier';
  const doc = mkDoc(t);
  const toks = [{ name: 'ListMark', from: 0, to: 1 }, { name: 'TaskMarker', from: 2, to: 5 }];
  const r = lpBuild(doc, toks, [{ from: 8, to: 8 }]);
  ok('E4a: Cursor auf der Task-Zeile -> kein Widget, keine done-Klasse', r.widgets.length === 0 && r.lines.length === 0, r.widgets);
}

// ── 33) Zwei einfache Bullets auf zwei Zeilen -> zwei Bullet-Widgets ──────
{
  const t = '- eins\n- zwei';
  const doc = mkDoc(t);
  const toks = [{ name: 'ListMark', from: 0, to: 1 }, { name: 'ListMark', from: 7, to: 8 }];
  const r = lpBuild(doc, toks, []);
  ok('E4a: 2 Bullet-Widgets {0,1}/{7,8}', r.widgets.length === 2 && r.widgets[0].from === 0 && r.widgets[1].from === 7 && r.widgets.every(w => w.type === 'bullet'), r.widgets);
}

// ── 34) Gemischte Zeile: Bullet-Zeile revealed, Task-Zeile nicht ──────────
{
  const t = '- eins\n- [ ] zwei';
  const doc = mkDoc(t);
  const toks = [{ name: 'ListMark', from: 0, to: 1 }, { name: 'ListMark', from: 7, to: 8 }, { name: 'TaskMarker', from: 9, to: 12 }];
  const r = lpBuild(doc, toks, [{ from: 3, to: 3 }]);   // Cursor in Zeile 1
  ok('E4a: Zeile 1 roh, Zeile 2 wird task-Widget {7,12}',
    r.widgets.length === 1 && r.widgets[0].type === 'task' && r.widgets[0].from === 7 && r.widgets[0].to === 12, r.widgets);
}

// ═══ E4b: Zeilen-Scanner (Wikilink/Highlight/Tag), Bild-Fix, Frontmatter-Guard ═══
console.log('\nE4b – Scanner, Bild, Frontmatter\n');

// ── 35) lpScanLine: alle drei Konstrukte, Offsets stimmen ─────────────────
{
  const t = 'Siehe [[Ziel|Alias]] und ==wichtig== mit #uni/mathe hier';
  const toks = lpScanLine(t, 100);
  const wiki = toks.find(x => x.name === 'Wikilink'), hi = toks.find(x => x.name === 'Highlight'), tag = toks.find(x => x.name === 'Tag');
  ok('Scanner: Wikilink mit Alias, Range exakt', wiki && wiki.from === 106 && wiki.to === 120 && wiki.data.inner === 'Ziel|Alias' && !wiki.data.embed, wiki);
  ok('Scanner: Highlight-Range exakt', hi && hi.from === 125 && hi.to === 136, hi);
  ok('Scanner: Tag mit / erkannt', tag && tag.data.tag === 'uni/mathe' && t.slice(tag.from - 100, tag.to - 100) === '#uni/mathe', tag);
  ok('Scanner: parentFrom/To = Konstrukt selbst (E1-Reveal gratis)', wiki.parentFrom === wiki.from && wiki.parentTo === wiki.to);
}

// ── 36) lpScanLine: Embed-Flag + Leerzeile ────────────────────────────────
{
  const e = lpScanLine('![[Bild.png]]', 0)[0];
  ok('Scanner: ![[..]] -> embed:true, Range ab dem !', e && e.data.embed && e.from === 0 && e.to === 13, e);
  ok('Scanner: leere Zeile -> keine Tokens', lpScanLine('', 0).length === 0);
}

// ── 37) Highlight in lpBuild: == verschwinden, Inhalt lp-mark ─────────────
{
  const t = 'a ==wichtig== b';
  const r = lpBuild(mkDoc(t), lpScanLine(t, 0), []);
  ok('E4b: beide ==-Paare versteckt', r.hide.length === 2 && r.hide[0].from === 2 && r.hide[0].to === 4 && r.hide[1].from === 11 && r.hide[1].to === 13, r.hide);
  ok('E4b: Inhalt als lp-mark markiert', r.marks.some(m => m.cls === 'lp-mark' && m.from === 4 && m.to === 11), r.marks);
  const rv = lpBuild(mkDoc(t), lpScanLine(t, 0), [{ from: 6, to: 6 }]);
  ok('E4b: Cursor im Highlight -> == sichtbar, Styling bleibt', rv.hide.length === 0 && rv.marks.some(m => m.cls === 'lp-mark'), rv.hide);
}

// ── 38) Tag in lpBuild: nur Styling, nichts versteckt ─────────────────────
{
  const t = 'Text #projekt dazu';
  const r = lpBuild(mkDoc(t), lpScanLine(t, 0), []);
  ok('E4b: Tag -> lp-tag-Mark, hide leer', r.hide.length === 0 && r.marks.some(m => m.cls === 'lp-tag' && t.slice(m.from, m.to) === '#projekt'), r.marks);
}

// ── 39) Code-Schutz: Pseudo-Token im InlineCode-Bereich wird verworfen ────
{
  const t = 'Code: `==kein Highlight==` hier';
  const toks = [{ name: 'InlineCode', from: 6, to: 26 }, ...lpScanLine(t, 0)];
  const r = lpBuild(mkDoc(t), toks, []);
  ok('E4b: ==..== im Code -> weder hide noch lp-mark', !r.marks.some(m => m.cls === 'lp-mark') && r.hide.length === 0, { marks: r.marks, hide: r.hide });
}

// ── 40) Bild-Fix: ![alt](url) versteckt auch die URL (parent Image) ──────
{
  const t = '![Logo](logo.png)';
  const doc = mkDoc(t);
  const toks = [
    { name: 'Image', from: 0, to: 17 },
    mtok('LinkMark', 0, 2, 'Image', 0, 17), mtok('LinkMark', 6, 7, 'Image', 0, 17),
    mtok('LinkMark', 7, 8, 'Image', 0, 17), mtok('LinkMark', 16, 17, 'Image', 0, 17),
    mtok('URL', 8, 16, 'Image', 0, 17),
  ];
  const r = lpBuild(doc, toks, []);
  const versteckt = r.hide.reduce((n, h) => n + (h.to - h.from), 0);
  ok('E4b: Marker+URL weg, sichtbar bleibt "Logo"', r.hide.length === 5 && versteckt === 13, r.hide);
  ok('E4b: Image als lp-link gestylt', r.marks.some(m => m.cls === 'lp-link' && m.from === 0 && m.to === 17), r.marks);
}

// ── 41) Frontmatter-Guard ────────────────────────────────────────────────
{
  const fm = '---\ntitle: Test\ntags: [a]\n---\n\n# Titel\n\n---\n\nText';
  const doc = mkDoc(fm);
  ok('Guard: Ende = Position des schliessenden ---', lpFrontmatterEnd(doc) === 29, lpFrontmatterEnd(doc));
  ok('Guard: ohne Frontmatter -> 0', lpFrontmatterEnd(mkDoc('# Titel\n---')) === 0);
  ok('Guard: unge­schlossen -> 0', lpFrontmatterEnd(mkDoc('---\ntitle: x\nkein Ende')) === 0);
  // Der SetextHeading-Fall: "title: Test" + "---" ergibt ein HeaderMark {26,29} - das MUSS
  // roh bleiben (im Guard-Bereich), waehrend das --- NACH dem Frontmatter ({39,42}) ein
  // HR-Widget werden darf.
  const toks = [
    mtok('HeaderMark', 26, 29, 'SetextHeading2', 4, 29),
    { name: 'HorizontalRule', from: 39, to: 42 },
  ];
  const r = lpBuild(doc, toks, []);
  ok('Guard: HeaderMark im Frontmatter bleibt sichtbar', r.hide.length === 0, r.hide);
  // Seit E6 kommt zusaetzlich das props-Widget ueber dem Frontmatter (Test 53).
  const hr = r.widgets.filter(w => w.type === 'hr');
  ok('Guard: --- nach dem Frontmatter wird HR-Widget', hr.length === 1 && hr[0].from === 39, r.widgets);
}

// ═══ E5: Wikilinks + Callouts ═══
console.log('\nE5 – Wikilinks & Callouts\n');

// ── 42) Wikilink ohne Alias: Klammern weg, Ziel sichtbar als lp-wikilink ──
{
  const t = 'Siehe [[START]] dazu';
  const r = lpBuild(mkDoc(t), lpScanLine(t, 0), []);
  ok('E5: [[ und ]] versteckt (2 Ranges)', r.hide.length === 2 && r.hide[0].from === 6 && r.hide[0].to === 8 && r.hide[1].from === 13 && r.hide[1].to === 15, r.hide);
  ok('E5: "START" als lp-wikilink', r.marks.some(m => m.cls === 'lp-wikilink' && t.slice(m.from, m.to) === 'START'), r.marks);
}

// ── 43) Mit Alias: "Ziel|" verschwindet mit, sichtbar nur der Alias ───────
{
  const t = '[[START|zum Anfang]]';
  const r = lpBuild(mkDoc(t), lpScanLine(t, 0), []);
  ok('E5: 3 hide-Ranges ([[ + "START|" + ]])', r.hide.length === 3, r.hide);
  ok('E5: sichtbar bleibt "zum Anfang"', r.marks.some(m => m.cls === 'lp-wikilink' && t.slice(m.from, m.to) === 'zum Anfang'), r.marks);
}

// ── 44) Mit #Anker: Label wie in renderWiki = "Ziel#Anker" ───────────────
{
  const t = '[[Notiz#Abschnitt]]';
  const r = lpBuild(mkDoc(t), lpScanLine(t, 0), []);
  ok('E5: "Notiz#Abschnitt" bleibt sichtbar', r.marks.some(m => m.cls === 'lp-wikilink' && t.slice(m.from, m.to) === 'Notiz#Abschnitt'), r.marks);
}

// ── 45) Embed: ![[ wird ⧉-Widget, Rest wie Wikilink ──────────────────────
{
  const t = 'Ein Embed: ![[START]]';
  const r = lpBuild(mkDoc(t), lpScanLine(t, 0), []);
  ok('E5: embed-Widget ersetzt "![[" ({11,14})', r.widgets.length === 1 && r.widgets[0].type === 'embed' && r.widgets[0].from === 11 && r.widgets[0].to === 14, r.widgets);
  ok('E5: "]]" versteckt, "START" lp-wikilink', r.hide.length === 1 && r.marks.some(m => m.cls === 'lp-wikilink' && t.slice(m.from, m.to) === 'START'), { hide: r.hide, marks: r.marks });
}

// ── 46) Reveal: Cursor im Wikilink -> Klammern sichtbar, Stil bleibt ──────
{
  const t = '[[START|zum Anfang]]';
  const r = lpBuild(mkDoc(t), lpScanLine(t, 0), [{ from: 4, to: 4 }]);
  ok('E5: revealed -> nichts versteckt, lp-wikilink bleibt', r.hide.length === 0 && r.widgets.length === 0 && r.marks.some(m => m.cls === 'lp-wikilink'), r.hide);
}

// ── 47) Callout: Kennung -> Icon-Widget, Zeilen lp-callout ────────────────
{
  const t = '> [!note] Callout-Titel\n> Callout-Inhalt hier';
  const doc = mkDoc(t);
  const r = lpBuild(doc, [{ name: 'Blockquote', from: 0, to: t.length }], []);
  ok('E5: beide Zeilen lp-callout', r.lines.length === 2 && r.lines.every(l => l.cls === 'lp-callout'), r.lines);
  ok('E5: callout-Widget ersetzt "[!note] " ({2,10}, typ note)',
    r.widgets.length === 1 && r.widgets[0].type === 'callout' && r.widgets[0].from === 2 && r.widgets[0].to === 10 && r.widgets[0].data.typ === 'note', r.widgets);
}

// ── 48) Callout mit Fold-Suffix + Grossschreibung -> typ normalisiert ─────
{
  const t = '> [!TIP]+ Aufklappbar';
  const r = lpBuild(mkDoc(t), [{ name: 'Blockquote', from: 0, to: t.length }], []);
  ok('E5: "[!TIP]+" -> typ "tip"', r.widgets.length === 1 && r.widgets[0].data.typ === 'tip', r.widgets);
}

// ── 49) Callout revealed: Kennung roh, Zeilen-Styling bleibt ──────────────
{
  const t = '> [!note] Titel\n> Inhalt';
  const r = lpBuild(mkDoc(t), [{ name: 'Blockquote', from: 0, to: t.length }], [{ from: 5, to: 5 }]);
  ok('E5: Cursor auf Titelzeile -> kein Icon-Widget, lp-callout bleibt',
    r.widgets.length === 0 && r.lines.every(l => l.cls === 'lp-callout'), r.widgets);
}

// ── 50) Normales Zitat bleibt lp-quote (kein Callout-Fehlalarm) ───────────
{
  const t = '> Ein normales Zitat';
  const r = lpBuild(mkDoc(t), [{ name: 'Blockquote', from: 0, to: t.length }], []);
  ok('E5: Zitat ohne [!..] -> lp-quote', r.lines.length === 1 && r.lines[0].cls === 'lp-quote', r.lines);
}

// ═══ E6: Codeblock, Tabelle, Properties, Bilder, Mathe ═══
console.log('\nE6 – Codeblock, Tabelle, Props, Bild, Mathe\n');

// ── 51) FencedCode: alle Zeilen lp-codeblock ──────────────────────────────
{
  const t = '```js\nconst x=1;\n```';
  const r = lpBuild(mkDoc(t), [{ name: 'FencedCode', from: 0, to: t.length }], []);
  ok('E6: 3 Zeilen lp-codeblock', r.lines.length === 3 && r.lines.every(l => l.cls === 'lp-codeblock'), r.lines);
}

// ── 52) Tabelle: Zeilen lp-table, Pipes lp-dim ────────────────────────────
{
  const t = '| a | b |\n|---|---|\n| 1 | 2 |';
  const r = lpBuild(mkDoc(t), [{ name: 'Table', from: 0, to: t.length }], []);
  ok('E6: 3 Zeilen lp-table', r.lines.length === 3 && r.lines.every(l => l.cls === 'lp-table'), r.lines);
  ok('E6: alle 9 Pipes lp-dim', r.marks.filter(m => m.cls === 'lp-dim').length === 9, r.marks.length);
}

// ── 53) Properties-Widget: Frontmatter kollabiert, Reveal -> roh ──────────
// lpPropsWidget ist BEWUSST nicht Teil von lpBuild: das Widget ersetzt Zeilenumbrueche,
// was CM6 aus ViewPlugins verbietet - es kommt aus einem StateField (live gecrasht:
// "Decorations that replace line breaks may not be specified via plugins").
{
  const fm = '---\ntitle: Test\ntags: [a]\n---\n\nText';
  const doc = mkDoc(fm);
  const w = lpPropsWidget(doc, []);
  ok('E6: props-Widget {0,29} mit n=2', w && w.type === 'props' && w.from === 0 && w.to === 29 && w.data.n === 2, w);
  ok('E6: Cursor im Frontmatter -> null (roh)', lpPropsWidget(doc, [{ from: 8, to: 8 }]) === null);
  ok('E6: ohne Frontmatter -> null', lpPropsWidget(mkDoc('# Titel'), []) === null);
}

// ── 54) Markdown-Bild: Punkt-Widget am Zeilenende mit roher src ───────────
{
  const t = 'Ein Bild: ![Logo](logo.png)';
  const doc = mkDoc(t);
  const toks = [
    { name: 'Image', from: 10, to: 27 },
    mtok('URL', 18, 26, 'Image', 10, 27),
  ];
  const r = lpBuild(doc, toks, []);
  const img = r.widgets.find(w => w.type === 'img');
  ok('E6: img-Widget als Punkt am Zeilenende ({27,27}, src roh)', img && img.from === 27 && img.to === 27 && img.data.src === 'logo.png', img);
  // Reveal aendert am Bild nichts (Obsidian-Verhalten):
  const rv = lpBuild(doc, toks, [{ from: 12, to: 12 }]);
  ok('E6: Bild-Widget bleibt bei Reveal', rv.widgets.some(w => w.type === 'img'), rv.widgets);
}

// ── 55) Wiki-Embed: nur Bild-Endungen bekommen eine Vorschau ──────────────
{
  const t = 'Foto: ![[urlaub.jpg]]';
  const r = lpBuild(mkDoc(t), lpScanLine(t, 0), []);
  const img = r.widgets.find(w => w.type === 'img');
  ok('E6: ![[x.jpg]] -> img-Widget mit data.wiki', img && img.data.wiki === 'urlaub.jpg' && img.from === t.length, img);
  const r2 = lpBuild(mkDoc('![[Notiz]]'), lpScanLine('![[Notiz]]', 0), []);
  ok('E6: ![[Notiz]] (kein Bild) -> kein img-Widget', !r2.widgets.some(w => w.type === 'img'), r2.widgets);
}

// ── 56) Mathe: $tex$ -> math-Widget; Reveal/Code -> roh ───────────────────
{
  const t = 'Inline $a^2+b^2=c^2$ dazu';
  const toks = lpScanLine(t, 0);
  ok('E6: Scanner findet MathInline mit tex', toks.some(x => x.name === 'MathInline' && x.data.tex === 'a^2+b^2=c^2'), toks);
  const r = lpBuild(mkDoc(t), toks, []);
  const mw = r.widgets.find(w => w.type === 'math');
  ok('E6: math-Widget ersetzt $..$ ({7,20})', mw && mw.from === 7 && mw.to === 20, mw);
  ok('E6: Cursor im Tex -> kein Widget', lpBuild(mkDoc(t), toks, [{ from: 10, to: 10 }]).widgets.length === 0);
  const tc = 'Code `$x$` hier';
  const r3 = lpBuild(mkDoc(tc), [{ name: 'InlineCode', from: 5, to: 10 }, ...lpScanLine(tc, 0)], []);
  ok('E6: $..$ im Code -> kein Widget', !r3.widgets.some(w => w.type === 'math'), r3.widgets);
  ok('E6: "$5 und $10" -> kein Fehlalarm', lpScanLine('Kostet $5 und $10 heute', 0).filter(x => x.name === 'MathInline').length === 0);
}

// ═══ Anker Leseansicht <-> Editor (Paul, 2026-07-17: "wenn ich in Zeile 30 bin und auf
//     Bearbeiten klicke, soll Zeile 30 an derselben Stelle stehen") ═══
console.log('\nAnker Leseansicht <-> Editor\n');

const NOTIZ = [
  '---', 'title: Test', '---', '',
  '# Grosse Ueberschrift', '',
  'Ein Absatz mit **fett** und `code` drin.', '',
  '## Abschnitt zwei', '',
  '- erster Punkt', '- zweiter Punkt', '',
  'Noch ein Absatz, der weiter unten steht und lang genug ist.', '',
  '> Ein Zitat hier', '',
  'Letzter Absatz zum Schluss.',
];

// Erwartung aus dem Array rechnen, nicht abzaehlen – von Hand hatte ich mich verzaehlt.
const zeileMit = (teil) => NOTIZ.findIndex(l => l.includes(teil));

// ── 15) Ueberschrift: gerenderter Text -> Quellzeile ────────────────────────
ok('Anker: "Abschnitt zwei" -> Quellzeile des "## " (im DOM ist der Marker weg)',
  lpLineForText(NOTIZ, 'Abschnitt zwei', strip) === zeileMit('## Abschnitt zwei'), lpLineForText(NOTIZ, 'Abschnitt zwei', strip));

// ── 16) Absatz mit Inline-Markdown: DOM-Text != Quelltext ──────────────────
ok('Anker: gerendertes "Ein Absatz mit fett und code drin." findet die Quellzeile mit **/`',
  lpLineForText(NOTIZ, 'Ein Absatz mit fett und code drin.', strip) === zeileMit('**fett**'),
  lpLineForText(NOTIZ, 'Ein Absatz mit fett und code drin.', strip));

// ── 17) Der Kernfall (Pauls Szenario): Block weiter unten -> nicht Zeile 0 ──
{
  const got = lpLineForText(NOTIZ, 'Noch ein Absatz, der weiter unten steht und lang genug ist.', strip);
  ok('Anker: Absatz weiter unten -> seine echte Quellzeile, NICHT 0', got === zeileMit('Noch ein Absatz') && got > 10, got);
}

// ── 18) Zitat ─────────────────────────────────────────────────────────────
ok('Anker: Zitat "Ein Zitat hier" -> Quellzeile mit "> "',
  lpLineForText(NOTIZ, 'Ein Zitat hier', strip) === zeileMit('> Ein Zitat'),
  lpLineForText(NOTIZ, 'Ein Zitat hier', strip));

// ── 18b) Nummerierte Ueberschrift: die Nummer gehoert zum Titel, nicht zur Liste ──
// Live an _System/Technische-Tipps.md aufgefallen: eine Schleife ueber alle Block-Marker
// frisst nach dem "## " auch das "17. " und findet die Zeile dann nie.
{
  const N = ['## 17. Wikilink-Parsing in Nexus: escapte Tabellen-Pipes', '', 'Text danach hier drin.'];
  ok('Anker: "## 17. Wikilink-Parsing…" -> Zeile 0 (die "17." bleibt Teil des Titels)',
    lpLineForText(N, '17. Wikilink-Parsing in Nexus: escapte Tabellen-Pipes', strip) === 0,
    lpLineForText(N, '17. Wikilink-Parsing in Nexus: escapte Tabellen-Pipes', strip));
}

// ── 18d) Checkbox-Zeile: "- [ ] " gehoert komplett zum Marker ─────────────
// Live an _System/Uni-Deadlines.md aufgefallen (152 Checkboxen): die Leseansicht rendert das
// "[ ]" als Kaestchen (.task-cb), im DOM steht nur der Text danach.
{
  const N = ['- [ ] 30.04. 08:00 UT VL Upload Metallkunde', '- [x] 23.04. erledigter Punkt hier'];
  ok('Anker: "- [ ] 30.04. …" -> Zeile 0', lpLineForText(N, '30.04. 08:00 UT VL Upload Metallkunde', strip) === 0,
    lpLineForText(N, '30.04. 08:00 UT VL Upload Metallkunde', strip));
  ok('Anker: "- [x] …" (erledigt) -> Zeile 1', lpLineForText(N, '23.04. erledigter Punkt hier', strip) === 1,
    lpLineForText(N, '23.04. erledigter Punkt hier', strip));
}

// ── 18e) Literaler Unterstrich (Wikilink-Ziel/Pfad): darf den Anker nicht killen ──
// Live an Nexus Muster-Vault/START.md aufgefallen: die Zeile
//   "- [[_System/Session-Start-Nexus]] – Schnellreferenz (Tools, Routinen)"
// rendert als Text "_System/Session-Start-Nexus – …" (der Renderer kursiviert das "_" NICHT).
// stripInline fraesst am Quelltext aber jeden "_" ("_System" -> "System") -> "_System/…" (Anker)
// traf nie "System/…" (Quelle), z=-1, der Editor sprang an den Dateianfang. lpNorm raeumt die
// Marker jetzt auf BEIDEN Seiten weg -> Treffer. (Reproduziert nur mit dem originalgetreuen
// strip-Stub oben; ohne dessen /[*_~`=]/-Sweep war der Test faelschlich gruen.)
{
  const N = ['- [[_System/Session-Start-Nexus]] – Schnellreferenz (Tools, Routinen)'];
  const rendered = '_System/Session-Start-Nexus – Schnellreferenz (Tools, Routinen)';
  ok('Anker: "_System/…"-Wikilink -> Zeile 0 trotz stripInline-Unterstrich', lpLineForText(N, rendered, strip) === 0,
    lpLineForText(N, rendered, strip));
}

// ── 18c) Verschachteltes Zitat mit Liste: beide Marker muessen weg ────────
{
  const N = ['> - ein Punkt im Zitat hier'];
  ok('Anker: "> - Punkt" -> beide Marker weg', lpLineForText(N, 'ein Punkt im Zitat hier', strip) === 0,
    lpLineForText(N, 'ein Punkt im Zitat hier', strip));
}

// ── 19) Kein Treffer -> -1, kein falscher Sprung an den Anfang ────────────
ok('Anker: unbekannter Text -> -1 (Aufrufer laesst die Position dann in Ruhe)',
  lpLineForText(NOTIZ, 'Diesen Text gibt es nirgends', strip) === -1);

// ── 20) Kurze Zeilen duerfen nicht zufaellig treffen ──────────────────────
ok('Anker: "---" trifft NICHT (zu kurz, sonst landet man im Frontmatter)',
  lpLineForText(NOTIZ, '---', strip) === -1, lpLineForText(NOTIZ, '---', strip));

// ── 21) Leerer/None-Text -> -1 ───────────────────────────────────────────
ok('Anker: leerer Text -> -1', lpLineForText(NOTIZ, '', strip) === -1 && lpLineForText(NOTIZ, null, strip) === -1);

// ── 22) Rueckrichtung: Quellzeile -> gerenderter Block ───────────────────
{
  const bloecke = [{ text: 'Grosse Ueberschrift' }, { text: 'Ein Absatz mit fett und code drin.' },
  { text: 'Abschnitt zwei' }, { text: 'erster Punkt zweiter Punkt' },
  { text: 'Noch ein Absatz, der weiter unten steht und lang genug ist.' }];
  ok('Anker rueckwaerts: "## Abschnitt zwei" -> Block 2', lpBlockForLine(bloecke, '## Abschnitt zwei', strip) === 2,
    lpBlockForLine(bloecke, '## Abschnitt zwei', strip));
  ok('Anker rueckwaerts: unbekannte Zeile -> -1', lpBlockForLine(bloecke, 'gibt es nicht hier', strip) === -1);
}

// ── 23) lpNorm ──────────────────────────────────────────────────────────
ok('lpNorm: Whitespace vereinheitlicht', lpNorm('  a \n\t b  ') === 'a b');
ok('lpNorm: null/undefined -> ""', lpNorm(null) === '' && lpNorm(undefined) === '');

console.log(`\n${pass} ok, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
