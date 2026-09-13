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
function aq(s){return (s==null?'':s).toString().replace(/"/g,'&quot;');}
function dangerScheme(u){return /^(javascript|data|vbscript|file):/i.test((u==null?'':u).toString().replace(/[\\u0000-\\u0020]+/g,''));}
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

// R27c: Sanitizer-Faelle. Unter Node gibt es kein DOM -> hier laeuft die Regex-Fallback-Stufe
// (sanitizeRawHtmlFallback); der DOMPurify-Pfad wird im Browser gegen dieselben Eingaben geprueft.
const x1 = renderMarkdown(['<div>', '<iframe srcdoc="<script>alert(1)</script>" src="x"></iframe>',
  '<object data="x.swf"></object><embed src="x"><meta http-equiv="refresh" content="0"><base href="http://evil/">',
  '<form action="http://evil"><input name="a"><button>b</button></form><link rel="stylesheet" href="x">', '</div>'].join('\n')).html;
ok('R27c iframe + srcdoc entfernt', !/<iframe|srcdoc/i.test(x1) && !/alert\(1\)/.test(x1), x1);
ok('R27c object/embed/meta/base/form/input/button/link entfernt', !/<(object|embed|meta|base|form|input|button|link)\b/i.test(x1), x1);
ok('R27c div-Huelle bleibt', x1.includes('<div>') && x1.includes('</div>'));
const x2 = renderMarkdown('<div><a href=javascript:alert(1)>u</a><a href="JaVaScRiPt:alert(2)">q</a><a href="&#106;avascript:alert(3)">e</a><a href="javascript&colon;alert(4)">c</a><a href="ja\tvascript:alert(5)">t</a></div>').html;
ok('R27c ungequotetes javascript: neutralisiert', !/href=javascript/i.test(x2) && !/alert\(1\)"/.test(x2), x2);
ok('R27c javascript: in jeder Schreibweise (Case, &#106;, &colon;, Tab) neutralisiert', !/javascript:/i.test(x2) && !/&#106;avascript/i.test(x2) && !/&colon;/i.test(x2) && (x2.match(/href="#"/g) || []).length === 5, x2);
const x3 = renderMarkdown('<svg viewBox="0 0 10 10"><use href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==" xlink:href="#x"/><rect width="1" height="1"/></svg>').html;
ok('R27c svg <use> entfernt, rect bleibt', !/<use\b/i.test(x3) && x3.includes('<rect'), x3);
const x4 = renderMarkdown('<div><style>body{display:none}</style>sichtbar</div>').html;
ok('R27c <style> samt Inhalt entfernt', !/<style|display:none/i.test(x4) && x4.includes('sichtbar'), x4);
const x5 = renderMarkdown('<div><img src="x" onerror="alert(1)"><img src=x onerror=alert(2)><span onmouseover=\'alert(3)\'>s</span></div>').html;
ok('R27c onerror/onmouseover (gequotet + ungequotet) entfernt', !/onerror|onmouseover|alert\(/i.test(x5) && (x5.match(/<img/g) || []).length === 2, x5);
const x6 = renderMarkdown('<div><a href="data:text/html;base64,PHNjcmlwdD4=">d</a><img src="data:image/png;base64,iVBOR"></div>').html;
ok('R27c data:text/html neutralisiert, data:image bleibt', !/data:text\/html/i.test(x6) && x6.includes('data:image/png;base64,iVBOR'), x6);
const x7 = renderMarkdown('<iframe src="https://evil"></iframe>\n\nText').html;
ok('R27c iframe ist kein Roh-HTML-Block mehr (wird escaped angezeigt)', x7.includes('&lt;iframe') && !/<iframe/i.test(x7), x7);
const x8 = renderMarkdown('<div><a href="https://ok.example/a?b=1" title="t">ok</a><video src="v.mp4" controls></video><details><summary>s</summary>x</details></div>').html;
ok('R27c erlaubtes HTML unveraendert (a/video/details)', x8.includes('href="https://ok.example/a?b=1"') && x8.includes('<video src="v.mp4" controls>') && x8.includes('<summary>s</summary>'), x8);

const gluedHtml = renderMarkdown('Absatz direkt davor\n<svg viewBox="0 0 10 10"><rect/></svg>').html;
ok('HTML-Block ohne Leerzeile trennt vom Absatz', gluedHtml.includes('<p>Absatz direkt davor</p>') && gluedHtml.includes('<svg viewBox="0 0 10 10">'));

// R25 Sicherheits-Regression (Stored-XSS): Attribut-Ausbruch via " + Scheme-Bypass via Steuerzeichen.
const xssImg = renderMarkdown('![a" onerror=hack() b](http://h/i.png)').html;
ok('Bild-alt: Anfuehrungszeichen escaped (kein Attribut-Ausbruch)', xssImg.includes('&quot;') && !/alt="a"\s+onerror/i.test(xssImg));
const xssLink = renderMarkdown('[k](http://h/a"onmouseover=hack())').html;
ok('Link-href: Anfuehrungszeichen escaped', xssLink.includes('&quot;') && !/href="http:\/\/h\/a"onmouseover/i.test(xssLink));
const xssPlain = renderMarkdown('[k](javascript:hack())').html;
ok('Link: javascript:-Schema nicht verlinkt', !/href="[^"]*javascript/i.test(xssPlain));
const xssCtrl = renderMarkdown('[k](' + String.fromCharCode(8) + 'javascript:hack())').html;
ok('Link: Steuerzeichen-Bypass (\\x08javascript:) neutralisiert', !/href="[^"]*javascript/i.test(xssCtrl));

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
