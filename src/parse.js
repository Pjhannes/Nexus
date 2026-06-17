// src/parse.js – Markdown parser: frontmatter, headings, wikilinks, tags
import { parse as parseYaml } from 'yaml';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HEADING_RE    = /^(#{1,6})\s+(.+)/;
// Permissiv: alles zwischen [[ ]] (inkl. "\" fuer escapte Tabellen-Pipes), nicht-greedy
// bis zum ersten ]]. Alias/Heading werden in extractLinks abgetrennt.
const WIKILINK_RE   = /\[\[([^\]\n]+?)\]\]/g;
const TAG_RE        = /(?:^|\s)#([\w/\-]+)/g;

// Code aus dem Body entfernen, damit dokumentierte Wikilink-BEISPIELE in Code-Spans/
// Fences NICHT als echte Links indiziert werden (wie Obsidian). Nur fuer die
// Link-Extraktion – Headings/Tags laufen weiter ueber den Originaltext.
function stripCode(body) {
  return (body || '')
    .replace(/```[\s\S]*?```/g, '')   // fenced code (```)
    .replace(/~~~[\s\S]*?~~~/g, '')   // fenced code (~~~)
    .replace(/`[^`\n]*`/g, '');       // inline code
}

// Code-bewusste Wikilink-Extraktion. Trennt Alias (escapter/normaler Pipe "\|"/"|")
// und Heading-Anker (#...) ab, strippt trailing Backslashes (escapte Tabellen-Pipes)
// und trimmt. Liefert [{target, alias}]. GEMEINSAME Quelle fuer App-Index (indexer.js)
// und scripts/vault-check.mjs, damit Check und App identisch parsen.
export function extractLinks(body) {
  const cleaned = stripCode(body);
  const out = [];
  WIKILINK_RE.lastIndex = 0;
  let m;
  while ((m = WIKILINK_RE.exec(cleaned)) !== null) {
    const [targetPart, ...aliasParts] = m[1].split(/\\?\|/);
    const target = targetPart.split('#')[0].trim().replace(/\\+$/, '').trim();
    if (!target || /^https?:/i.test(target)) continue;
    const alias = aliasParts.length ? aliasParts.join('|').trim() : '';
    out.push({ target, alias: alias || null });
  }
  return out;
}

export function parseNote(content) {
  let body = content;
  let frontmatter = {};

  const fm = content.match(FRONTMATTER_RE);
  if (fm) {
    try { frontmatter = parseYaml(fm[1]) ?? {}; } catch { frontmatter = {}; }
    body = content.slice(fm[0].length);
  }

  // Title: frontmatter.title > first H1 > filename (caller fills filename fallback)
  let title = frontmatter.title ?? null;
  const headings = [];
  let lineNo = (fm ? fm[0].split('\n').length - 1 : 0);

  for (const line of body.split('\n')) {
    lineNo++;
    const h = line.match(HEADING_RE);
    if (h) {
      headings.push({ level: h[1].length, text: h[2].trim(), line: lineNo });
      if (!title && h[1].length === 1) title = h[2].trim();
    }
  }

  // Tags: frontmatter.tags + inline #tags
  const fmTags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.map(String)
    : frontmatter.tags ? [String(frontmatter.tags)] : [];
  const inlineTags = [...body.matchAll(TAG_RE)].map(m => m[1]);
  const tags = [...new Set([...fmTags, ...inlineTags])];

  // Wikilinks – code-bewusst, Alias/Heading/escapte Pipes normalisiert (siehe extractLinks)
  const links = extractLinks(body);

  return { frontmatter, title, headings, tags, links, body };
}
