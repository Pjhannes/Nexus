// src/dataview.js – Pure Dataview-(DQL)-Engine: parst + fuehrt LIST/TABLE aus.
//
// KEINE fs-/DB-Zugriffe, kein Date.now(): der Aufrufer liefert die "pages" (Notiz-
// Metadaten) + optional `now`. Dadurch ohne MCP-/HTTP-Transport testbar (Arbeitsweise R6).
//
// Unterstuetzter DQL-Subset (deckt alle im Vault real genutzten Queries ab):
//   LIST [expr]
//   TABLE [WITHOUT ID] expr [AS "Header"], ...
//   FROM "ordner" [or "ordner2"] [-"ausschluss"] [#tag]
//   WHERE <bool-expr>   (AND/OR, !/NOT, = == != < > <= >=, contains(), Felder, file.*)
//   SORT  expr [ASC|DESC] [, expr [ASC|DESC]]
//   LIMIT n
// Funktionen: contains, dateformat, lower, upper, length, default, startswith,
//             endswith, string, number, round.
//
// page-Form (vom Aufrufer):
//   { file: { path, name, folder, link:{__link,path,display}, mtime, ctime, size, tags[], etags[] },
//     fm: {<frontmatter>} }

// ───────────────────────── Tokenizer ─────────────────────────
const CLAUSE_KW = new Set(['FROM', 'WHERE', 'SORT', 'GROUP', 'FLATTEN', 'LIMIT']);

function tokenize(src) {
  const s = src, n = s.length, toks = [];
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    // String-Literal (' oder ")
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1, str = '';
      while (j < n && s[j] !== q) {
        if (s[j] === '\\' && j + 1 < n) { str += s[j + 1]; j += 2; }
        else { str += s[j]; j++; }
      }
      toks.push({ t: 'str', v: str }); i = j + 1; continue;
    }
    // Zahl
    if (c >= '0' && c <= '9') {
      let j = i; while (j < n && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
      toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) }); i = j; continue;
    }
    // Tag (#foo, #foo/bar)
    if (c === '#') {
      let j = i + 1; while (j < n && /[A-Za-z0-9_/\-À-ɏ]/.test(s[j])) j++;
      toks.push({ t: 'str', v: s.slice(i, j) }); i = j; continue;   // Tag wie String-Literal behandeln
    }
    // Identifier / Feldpfad (file.mtime, status, …)
    if (/[A-Za-z_À-ɏ]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_.À-ɏ]/.test(s[j])) j++;
      const v = s.slice(i, j);
      toks.push({ t: 'id', v, u: v.toUpperCase() }); i = j; continue;
    }
    // Zwei-Zeichen-Operatoren
    const two = s.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' || two === '&&' || two === '||') {
      toks.push({ t: 'op', v: two }); i += 2; continue;
    }
    // Ein-Zeichen-Operatoren
    if ('()!,<>=+-*/'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    // Unbekanntes Zeichen ueberspringen (robust statt harter Fehler)
    i++;
  }
  return toks;
}

// ───────────────────────── Query-Aufteilung ─────────────────────────
function splitTopLevel(toks, isSep) {
  const out = []; let cur = []; let depth = 0;
  for (const t of toks) {
    if (t.t === 'op' && t.v === '(') depth++;
    else if (t.t === 'op' && t.v === ')') depth--;
    if (depth === 0 && isSep(t)) { out.push(cur); cur = []; continue; }
    cur.push(t);
  }
  out.push(cur);
  return out;
}

function exprText(toks) {
  return toks.map(t => t.t === 'str' ? '"' + t.v + '"' : String(t.v)).join(' ').replace(/\s+([.,()])/g, '$1');
}

// ───────────────────────── Ausdrucks-Parser (Recursive Descent) ─────────────────────────
function parseExpr(toks) {
  const p = { toks, i: 0 };
  const e = pOr(p);
  if (p.i < toks.length) throw new Error('Unerwartetes Token im Ausdruck: ' + JSON.stringify(toks[p.i]));
  return e;
}
const peek = p => p.toks[p.i];
const isId = (t, u) => t && t.t === 'id' && t.u === u;
const isOp = (t, v) => t && t.t === 'op' && t.v === v;

function pOr(p) {
  let l = pAnd(p);
  while (isId(peek(p), 'OR') || isOp(peek(p), '||')) { p.i++; l = { type: 'or', l, r: pAnd(p) }; }
  return l;
}
function pAnd(p) {
  let l = pNot(p);
  while (isId(peek(p), 'AND') || isOp(peek(p), '&&')) { p.i++; l = { type: 'and', l, r: pNot(p) }; }
  return l;
}
function pNot(p) {
  if (isOp(peek(p), '!') || isId(peek(p), 'NOT')) { p.i++; return { type: 'not', e: pNot(p) }; }
  return pCmp(p);
}
function pCmp(p) {
  const l = pAdd(p);
  const t = peek(p);
  if (t && t.t === 'op' && ['=', '==', '!=', '<', '>', '<=', '>='].includes(t.v)) {
    p.i++; return { type: 'cmp', op: t.v, l, r: pAdd(p) };
  }
  return l;
}
function pAdd(p) {
  let l = pMul(p);
  while (isOp(peek(p), '+') || isOp(peek(p), '-')) { const op = peek(p).v; p.i++; l = { type: 'bin', op, l, r: pMul(p) }; }
  return l;
}
function pMul(p) {
  let l = pUnary(p);
  while (isOp(peek(p), '*') || isOp(peek(p), '/')) { const op = peek(p).v; p.i++; l = { type: 'bin', op, l, r: pUnary(p) }; }
  return l;
}
function pUnary(p) {
  if (isOp(peek(p), '-')) { p.i++; return { type: 'neg', e: pUnary(p) }; }
  return pPrimary(p);
}
function pPrimary(p) {
  const t = peek(p);
  if (!t) throw new Error('Ausdruck unerwartet zu Ende');
  if (t.t === 'num' || t.t === 'str') { p.i++; return { type: 'lit', v: t.v }; }
  if (isOp(t, '(')) {
    p.i++; const e = pOr(p);
    if (!isOp(peek(p), ')')) throw new Error('Fehlende schliessende Klammer');
    p.i++; return e;
  }
  if (t.t === 'id') {
    p.i++;
    if (isOp(peek(p), '(')) {          // Funktionsaufruf
      p.i++; const args = [];
      if (!isOp(peek(p), ')')) {
        args.push(pOr(p));
        while (isOp(peek(p), ',')) { p.i++; args.push(pOr(p)); }
      }
      if (!isOp(peek(p), ')')) throw new Error('Fehlende ) im Funktionsaufruf ' + t.v);
      p.i++; return { type: 'call', name: t.v.toLowerCase(), args };
    }
    if (t.u === 'TRUE') return { type: 'lit', v: true };
    if (t.u === 'FALSE') return { type: 'lit', v: false };
    if (t.u === 'NULL') return { type: 'lit', v: null };
    return { type: 'field', path: t.v };
  }
  throw new Error('Unerwartetes Token: ' + JSON.stringify(t));
}

// ───────────────────────── Query-Parser (Top-Level) ─────────────────────────
export function parseDataview(source) {
  let toks;
  try { toks = tokenize(source); } catch (e) { return { error: 'Tokenize-Fehler: ' + e.message }; }
  if (!toks.length) return { error: 'Leere Query' };
  const cmdTok = toks[0];
  if (cmdTok.t !== 'id') return { error: 'Query muss mit LIST/TABLE/TASK beginnen' };
  const cmd = cmdTok.u;
  if (!['LIST', 'TABLE', 'TASK', 'CALENDAR'].includes(cmd)) return { error: 'Unbekannter Query-Typ: ' + cmdTok.v };

  let idx = 1, withoutId = false;
  if (cmd === 'TABLE' && isId(toks[idx], 'WITHOUT') && isId(toks[idx + 1], 'ID')) { withoutId = true; idx += 2; }

  // Head (Feldliste / LIST-Expr) + Klauseln trennen
  const head = []; const sections = []; let cur = null; let depth = 0;
  for (let k = idx; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'op' && t.v === '(') depth++;
    else if (t.t === 'op' && t.v === ')') depth--;
    if (depth === 0 && t.t === 'id' && CLAUSE_KW.has(t.u)) {
      cur = { kw: t.u, toks: [] }; sections.push(cur);
      if (t.u === 'GROUP' && isId(toks[k + 1], 'BY')) k++;   // GROUP BY → "BY" ueberspringen
      continue;
    }
    if (cur) cur.toks.push(t); else head.push(t);
  }

  const ast = { cmd, withoutId, fields: [], listExpr: null, from: null, where: null, sort: [], limit: null, unsupported: null };
  if (cmd === 'TASK' || cmd === 'CALENDAR') ast.unsupported = cmd + ' wird in Nexus (noch) nicht unterstuetzt.';

  try {
    // Head auswerten
    if (cmd === 'TABLE') {
      if (head.length) {
        for (const seg of splitTopLevel(head, t => t.t === 'op' && t.v === ',')) {
          if (!seg.length) continue;
          // top-level AS finden
          let asAt = -1, d = 0;
          for (let k = 0; k < seg.length; k++) {
            const t = seg[k];
            if (t.t === 'op' && t.v === '(') d++;
            else if (t.t === 'op' && t.v === ')') d--;
            else if (d === 0 && t.t === 'id' && t.u === 'AS') { asAt = k; break; }
          }
          const exprToks = asAt >= 0 ? seg.slice(0, asAt) : seg;
          let header = exprText(exprToks);
          if (asAt >= 0) { const h = seg[asAt + 1]; if (h) header = (h.t === 'str') ? h.v : String(h.v); }
          ast.fields.push({ expr: parseExpr(exprToks), header });
        }
      }
    } else if (cmd === 'LIST') {
      const first = splitTopLevel(head, t => t.t === 'op' && t.v === ',')[0] || [];
      // optionales "AS" abschneiden
      let endAt = first.length, d = 0;
      for (let k = 0; k < first.length; k++) {
        const t = first[k];
        if (t.t === 'op' && t.v === '(') d++;
        else if (t.t === 'op' && t.v === ')') d--;
        else if (d === 0 && t.t === 'id' && t.u === 'AS') { endAt = k; break; }
      }
      const exprToks = first.slice(0, endAt);
      if (exprToks.length) ast.listExpr = parseExpr(exprToks);
    }

    // Klauseln auswerten
    for (const sec of sections) {
      if (sec.kw === 'FROM') ast.from = parseFrom(sec.toks);
      else if (sec.kw === 'WHERE') { if (sec.toks.length) ast.where = parseExpr(sec.toks); }
      else if (sec.kw === 'SORT') ast.sort = parseSort(sec.toks);
      else if (sec.kw === 'LIMIT') { const num = sec.toks.find(t => t.t === 'num'); if (num) ast.limit = num.v; }
      // GROUP/FLATTEN bewusst ignoriert (im Vault nicht genutzt)
    }
  } catch (e) { return { error: 'Parse-Fehler: ' + e.message }; }

  return { ast };
}

function parseFrom(toks) {
  const include = [], exclude = [], tags = [];
  let negate = false;
  for (const t of toks) {
    if (t.t === 'op' && (t.v === '-' || t.v === '!')) { negate = true; continue; }
    if (t.t === 'id' && (t.u === 'OR' || t.u === 'AND')) { negate = false; continue; }
    if (t.t === 'op' && t.v === ',') { negate = false; continue; }
    if (t.t === 'str') {
      const v = t.v;
      if (v.startsWith('#')) { tags.push(v); negate = false; continue; }
      (negate ? exclude : include).push(v.replace(/\/+$/, '')); negate = false;
    }
  }
  return { include, exclude, tags };
}

function parseSort(toks) {
  const out = [];
  for (const seg of splitTopLevel(toks, t => t.t === 'op' && t.v === ',')) {
    if (!seg.length) continue;
    let dir = 'ASC'; let exprToks = seg;
    const last = seg[seg.length - 1];
    if (last && last.t === 'id' && (last.u === 'ASC' || last.u === 'DESC')) { dir = last.u; exprToks = seg.slice(0, -1); }
    if (exprToks.length) out.push({ expr: parseExpr(exprToks), dir });
  }
  return out;
}

// ───────────────────────── Auswertung ─────────────────────────
function truthy(v) {
  if (v == null || v === false) return false;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
function looksNum(x) { return typeof x === 'number' || (typeof x === 'string' && x.trim() !== '' && !isNaN(Number(x))); }
function unlink(v) { return (v && v.__link) ? v.display : v; }

function eqVal(a, b) {
  a = unlink(a); b = unlink(b);
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a) === String(b);
}
function cmpVals(a, b) {
  a = unlink(a); b = unlink(b);
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (looksNum(a) && looksNum(b)) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'de');
}
function compare(op, a, b) {
  switch (op) {
    case '=': case '==': return eqVal(a, b);
    case '!=': return !eqVal(a, b);
    case '<': return cmpVals(a, b) < 0;
    case '>': return cmpVals(a, b) > 0;
    case '<=': return cmpVals(a, b) <= 0;
    case '>=': return cmpVals(a, b) >= 0;
  }
  return false;
}

function resolveField(page, path) {
  const parts = path.split('.');
  if (parts[0] === 'file') {
    let cur = page.file;
    for (let k = 1; k < parts.length; k++) { if (cur == null) return undefined; cur = cur[parts[k]]; }
    return cur;
  }
  // Frontmatter
  let cur = page.fm;
  for (const part of parts) { if (cur == null || typeof cur !== 'object') return undefined; cur = cur[part]; }
  return cur;
}

function evalNode(node, page) {
  switch (node.type) {
    case 'lit': return node.v;
    case 'field': return resolveField(page, node.path);
    case 'not': return !truthy(evalNode(node.e, page));
    case 'neg': return -Number(evalNode(node.e, page));
    case 'and': return truthy(evalNode(node.l, page)) && truthy(evalNode(node.r, page));
    case 'or': return truthy(evalNode(node.l, page)) || truthy(evalNode(node.r, page));
    case 'cmp': return compare(node.op, evalNode(node.l, page), evalNode(node.r, page));
    case 'bin': {
      const a = evalNode(node.l, page), b = evalNode(node.r, page);
      if (node.op === '+') return (typeof a === 'string' || typeof b === 'string') ? String(a ?? '') + String(b ?? '') : Number(a) + Number(b);
      if (node.op === '-') return Number(a) - Number(b);
      if (node.op === '*') return Number(a) * Number(b);
      if (node.op === '/') return Number(a) / Number(b);
      return undefined;
    }
    case 'call': return callFn(node.name, node.args.map(a => evalNode(a, page)), page);
  }
  return undefined;
}

function callFn(name, args, page) {
  const a = args[0], b = args[1];
  switch (name) {
    case 'contains': {
      if (a == null) return false;
      const needle = unlink(b);
      if (Array.isArray(a)) return a.some(x => { x = unlink(x); return x === needle || (typeof x === 'string' && typeof needle === 'string' && x.includes(needle)); });
      return String(unlink(a)).includes(String(needle));
    }
    case 'dateformat': return formatDate(toDate(a), String(b ?? ''));
    case 'dur': case 'date': return a;
    case 'lower': return String(unlink(a) ?? '').toLowerCase();
    case 'upper': return String(unlink(a) ?? '').toUpperCase();
    case 'length': return Array.isArray(a) ? a.length : String(unlink(a) ?? '').length;
    case 'default': return (a == null || a === '') ? b : a;
    case 'startswith': return String(unlink(a) ?? '').startsWith(String(unlink(b) ?? ''));
    case 'endswith': return String(unlink(a) ?? '').endsWith(String(unlink(b) ?? ''));
    case 'string': return String(unlink(a) ?? '');
    case 'number': return Number(unlink(a));
    case 'round': { const d = b == null ? 0 : Number(b); const f = Math.pow(10, d); return Math.round(Number(a) * f) / f; }
    default: return undefined;
  }
}

// ───────────────────────── Datums-Formatierung (Luxon-Subset) ─────────────────────────
function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (x, n = 2) => String(x).padStart(n, '0');
function formatDate(d, fmt) {
  if (!d) return '';
  const tokens = ['yyyy', 'yy', 'MMMM', 'MMM', 'MM', 'M', 'dd', 'd', 'EEEE', 'EEE', 'HH', 'H', 'hh', 'h', 'mm', 'm', 'ss', 's', 'a'];
  let out = '', i = 0;
  while (i < fmt.length) {
    if (fmt[i] === "'") {          // Luxon-Literal in einfachen Anfuehrungszeichen
      let j = i + 1; while (j < fmt.length && fmt[j] !== "'") j++;
      out += fmt.slice(i + 1, j); i = j + 1; continue;
    }
    let matched = null;
    for (const tk of tokens) { if (fmt.startsWith(tk, i)) { matched = tk; break; } }
    if (!matched) { out += fmt[i]; i++; continue; }
    out += fmtToken(matched, d); i += matched.length;
  }
  return out;
}
function fmtToken(tk, d) {
  const h12 = (d.getHours() % 12) || 12;
  switch (tk) {
    case 'yyyy': return String(d.getFullYear());
    case 'yy': return pad(d.getFullYear() % 100);
    case 'MMMM': return MONTHS[d.getMonth()];
    case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
    case 'MM': return pad(d.getMonth() + 1);
    case 'M': return String(d.getMonth() + 1);
    case 'dd': return pad(d.getDate());
    case 'd': return String(d.getDate());
    case 'EEEE': return DAYS[d.getDay()];
    case 'EEE': return DAYS[d.getDay()].slice(0, 3);
    case 'HH': return pad(d.getHours());
    case 'H': return String(d.getHours());
    case 'hh': return pad(h12);
    case 'h': return String(h12);
    case 'mm': return pad(d.getMinutes());
    case 'm': return String(d.getMinutes());
    case 'ss': return pad(d.getSeconds());
    case 's': return String(d.getSeconds());
    case 'a': return d.getHours() < 12 ? 'AM' : 'PM';
  }
  return tk;
}

// ───────────────────────── FROM-Matching ─────────────────────────
function inFolder(path, folder) {
  if (folder === '' || folder === '/') return true;       // ganzer Vault
  return path === folder || path.startsWith(folder + '/');
}
function matchFrom(from, page) {
  if (!from) return true;
  const path = page.file.path;
  if (from.include.length && !from.include.some(f => inFolder(path, f))) return false;
  if (from.exclude.some(f => inFolder(path, f))) return false;
  if (from.tags.length) {
    const tags = page.file.tags || [];
    if (!from.tags.every(t => tags.includes(t))) return false;
  }
  return true;
}

// ───────────────────────── Zell-Serialisierung ─────────────────────────
function toCell(v) {
  if (v == null) return { type: 'text', text: '' };
  if (v.__link) return { type: 'link', path: v.path, text: v.display };
  if (Array.isArray(v)) {
    if (v.length && v.every(x => x && x.__link)) return { type: 'links', items: v.map(x => ({ path: x.path, text: x.display })) };
    return { type: 'text', text: v.map(x => (x && x.__link) ? x.display : String(x)).join(', ') };
  }
  if (typeof v === 'object') return { type: 'text', text: JSON.stringify(v) };
  return { type: 'text', text: String(v) };
}
function linkCell(page) { return { type: 'link', path: page.file.path, text: page.file.name }; }

// ───────────────────────── Ausfuehrung ─────────────────────────
export function runDataview(ast, pages) {
  if (ast.unsupported) return { kind: ast.cmd, unsupported: true, note: ast.unsupported, count: 0, rows: [] };

  let rows = pages.filter(p => matchFrom(ast.from, p));
  if (ast.where) {
    rows = rows.filter(p => { try { return truthy(evalNode(ast.where, p)); } catch { return false; } });
  }
  if (ast.sort.length) {
    rows.sort((pa, pb) => {
      for (const s of ast.sort) {
        let va, vb;
        try { va = evalNode(s.expr, pa); } catch { va = undefined; }
        try { vb = evalNode(s.expr, pb); } catch { vb = undefined; }
        let c = cmpVals(va, vb);
        if (s.dir === 'DESC') c = -c;
        if (c) return c;
      }
      return 0;
    });
  }
  if (ast.limit != null) rows = rows.slice(0, Math.max(0, ast.limit));

  const safe = (expr, p) => { try { return evalNode(expr, p); } catch { return undefined; } };

  if (ast.cmd === 'TABLE') {
    const headers = [];
    if (!ast.withoutId) headers.push('Datei');
    for (const f of ast.fields) headers.push(f.header);
    const outRows = rows.map(p => {
      const cells = [];
      if (!ast.withoutId) cells.push(linkCell(p));
      for (const f of ast.fields) cells.push(toCell(safe(f.expr, p)));
      return cells;
    });
    return { kind: 'TABLE', headers, rows: outRows, count: rows.length };
  }
  // LIST
  const outRows = rows.map(p => ({ cell: toCell(ast.listExpr ? safe(ast.listExpr, p) : p.file.link) }));
  return { kind: 'LIST', rows: outRows, count: rows.length };
}

// Komfort: parsen + ausfuehren in einem Aufruf.
export function evaluateDataview(source, pages) {
  const parsed = parseDataview(source);
  if (parsed.error) return { error: parsed.error };
  return runDataview(parsed.ast, pages);
}
