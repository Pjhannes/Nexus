// test/md-render.test.mjs – Verifiziert den Markdown-Renderer aus public/index.html.
// Der Renderer ist DOM-frei zwischen den Markern //__MD_START__ und //__MD_END__ gekapselt.
// Lauf: node test/md-render.test.mjs   (aus D:\Nexus bzw. /tmp-Kopie in der Sandbox)
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dir, '..', 'public', 'index.html'), 'utf8');
const a = html.indexOf('//__MD_START__');
const b = html.indexOf('//__MD_END__');
if (a < 0 || b < 0) { console.error('Marker //__MD_START__/__MD_END__ nicht gefunden'); process.exit(1); }
const core = html.slice(a, b);

// Stubs fuer die Browser-/App-Abhaengigkeiten des Renderers
const stub = `
const IMG_EXT=['.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp','.avif'];
function esc(s){return (s==null?'':s).toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escHtml(s){return (s==null?'':s).toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fileUrl(p){return '/api/file?path='+encodeURIComponent(p);}
let vaultTree=[{type:'folder',name:'Wissen',children:[{type:'file',name:'Controlling.md',path:'Wissen/Controlling.md',ext:'.md'}]},{type:'file',name:'bild.png',path:'bild.png',ext:'.png'}];
let selectedPath='Start.md';
function resolveWiki(t){t=(t||'').toLowerCase();if(t==='controlling'||t==='wissen/controlling')return 'Wissen/Controlling.md';return null;}
`;
const mod = await import('data:text/javascript,' + encodeURIComponent(stub + core + '\nexport {renderMarkdown};'));
const { renderMarkdown } = mod;

let pass = 0, fail = 0;
function ok(label, cond) { if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; } else { console.log('  \x1b[31m✗\x1b[0m', label); fail++; } }

const md = [
'---','title: Test','tags: [a, b]','status: aktiv','---','',
'# H1','','Ein **fett** *kursiv* ==mark== ~~weg~~ `code`. Zahl 2024 und 15 bleiben.','',
'Siehe [[Controlling]] und [[Controlling#K|Alias]] sowie [[Fehlt]]. #tag/x [ext](https://e.com?a=1&b=2).','',
'![[bild.png]]','![[Controlling]]','',
'> [!warning] Achtung','> - eins','> - zwei','','> [!tip]- zu','> versteckt','',
'- a','  - b','- [ ] offen','- [x] fertig','','1. eins','2. zwei','',
'| X | Y |','|:--|--:|','| 1 | 2 |','| 3 | 4 |','',
'```js','const x=1>0;','```','',
'Inline $E=mc^2$','','$$','\\int_0^1','$$','','Fuss[^1].','','[^1]: Def.',
].join('\n');

const r = renderMarkdown(md);
ok('Frontmatter title', r.frontmatter && r.frontmatter.title === 'Test');
ok('Frontmatter tags-Array', Array.isArray(r.frontmatter.tags) && r.frontmatter.tags.length === 2);
ok('6 Headings? (mind. 1)', r.headings.length >= 1 && r.headings[0].id === 'h1');
ok('Bold', r.html.includes('<strong>fett</strong>'));
ok('Highlight', r.html.includes('<mark>mark</mark>'));
ok('Zahl 2024 erhalten', r.html.includes('2024') && !r.html.includes('amp;amp;'));
ok('Wikilink aufgeloest', r.html.includes('data-path="Wissen/Controlling.md"'));
ok('Wikilink Alias', r.html.includes('>Alias</a>'));
ok('Wikilink broken', r.html.includes('wikilink broken'));
ok('Tag klickbar', r.html.includes('data-tag="tag/x"'));
ok('Externer Link einfach-escaped', r.html.includes('href="https://e.com?a=1&amp;b=2"') && !r.html.includes('&amp;amp;'));
ok('Bild-Embed', r.html.includes('<img class="md-img"') && r.html.includes('bild.png'));
ok('Noten-Transklusion', r.html.includes('class="transclude"') && r.html.includes('data-embed="Wissen/Controlling.md"'));
ok('Callout warning', r.html.includes('class="callout"') && r.html.includes('Achtung'));
ok('Callout kollabiert', r.html.includes('callout foldable collapsed'));
ok('Task offen+fertig', r.html.includes('task-item') && r.html.includes('task-item done'));
ok('Verschachtelte Liste', /<ul><li>a<ul><li>b<\/li><\/ul><\/li>/.test(r.html));
ok('Ordered Liste', r.html.includes('<ol><li>eins</li>'));
ok('Tabelle beide Zeilen', r.html.includes('<td style="text-align:left">1</td>') && r.html.includes('>3</td>'));
ok('Tabelle Ausrichtung rechts', r.html.includes('text-align:right'));
ok('Codeblock escaped', r.html.includes('const x=1&gt;0;') && r.html.includes('cb-copy'));
ok('Inline-Math', r.html.includes('math-inline') && r.html.includes('data-tex="E=mc^2"'));
ok('Block-Math', r.html.includes('class="math-block"'));
ok('Footnote ref+def', r.html.includes('fnref-1') && r.html.includes('id="fn-1"'));
ok('Links gesammelt', r.links.includes('Wissen/Controlling.md'));

// ── Roh-HTML / inline-SVG durchreichen (Session 45) ──
const svg = renderMarkdown([
  'Text davor.','',
  '<details><summary>📊 Diagramm</summary>','',
  '<svg width="100%" viewBox="0 0 680 360" role="img">',
  '  <title>Test</title>',
  '  <rect class="bx" x="46" y="68" width="250" height="100"/>',
  '  <text x="64" y="96">1 · Entwickler & "Zeug"</text>',
  '</svg>','',
  '</details>','',
  'Text danach mit a < b und 2024.',
].join('\n')).html;
ok('SVG-Tag roh durchgereicht (nicht escaped)', svg.includes('<svg width="100%" viewBox="0 0 680 360"') && !svg.includes('&lt;svg'));
ok('SVG-Kindelemente erhalten', svg.includes('<rect class="bx"') && svg.includes('<text x="64"'));
ok('details/summary erhalten', svg.includes('<details>') && svg.includes('<summary>📊 Diagramm</summary>') && svg.includes('</details>'));
ok('Text vor/nach SVG normal gerendert', svg.includes('<p>Text davor.</p>') && svg.includes('Text danach'));
ok('Echtes < ausserhalb HTML weiter escaped', svg.includes('a &lt; b'));

const evil = renderMarkdown([
  '<div onclick="steal()">',
  '<script>alert(1)<\/script>',
  '<a href="javascript:evil()">x</a>',
  '</div>',
].join('\n')).html;
ok('Script-Tag entfernt', !/<script/i.test(evil));
ok('Inline-Event-Handler entfernt', !/onclick/i.test(evil));
ok('javascript:-URL neutralisiert', !/javascript:/i.test(evil) && evil.includes('href="#"'));

const gluedHtml = renderMarkdown('Absatz direkt davor\n<svg viewBox="0 0 10 10"><rect/></svg>').html;
ok('HTML-Block ohne Leerzeile trennt vom Absatz', gluedHtml.includes('<p>Absatz direkt davor</p>') && gluedHtml.includes('<svg viewBox="0 0 10 10">'));

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
