// src/parse.js – Markdown parser: frontmatter, headings, wikilinks, tags
import { parse as parseYaml } from 'yaml';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HEADING_RE    = /^(#{1,6})\s+(.+)/;
const WIKILINK_RE   = /\[\[([^\]|#]+)(?:#[^\]|]*)?\|?([^\]]*)\]\]/g;
const TAG_RE        = /(?:^|\s)#([\w/\-]+)/g;

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

  // Wikilinks
  const links = [];
  let m;
  WIKILINK_RE.lastIndex = 0;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    links.push({ target: m[1].trim(), alias: m[2] || null });
  }

  return { frontmatter, title, headings, tags, links, body };
}
