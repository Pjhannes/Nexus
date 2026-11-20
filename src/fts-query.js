// src/fts-query.js – Suchanfrage -> FTS5-MATCH-Ausdruck (R29/N1). Pure Funktionen, ohne DB testbar.
//
// Vorher haengte buildFtsQuery an JEDES Wort ein "*" und warf alle Sonderzeichen weg: aus
// `"Remote-MCP" OR "Custom Connector"` wurde `Remote* MCP* OR* Custom* Connector*` -> je nach
// Eingabe "fts5: syntax error" oder unscharfe Treffer. Die Tool-Beschreibung versprach aber
// AND/OR/NOT, "Phrase" und praefix*.
//
// Unterstuetzt:
//   wort wort          alle Woerter muessen vorkommen (AND)
//   "exakte phrase"    Woerter direkt hintereinander
//   AND  OR  NOT       Operatoren, nur GROSS geschrieben (klein = normales Suchwort);
//                      NOT ist zweistellig (a NOT b) – Rangfolge NOT vor AND vor OR
//   ( ... )            Klammern
//   wort*  "phrase"*   Wortanfang (Praefix) – explizit
//   letztes Wort       zaehlt ohne Anfuehrungszeichen ebenfalls als Wortanfang (Tippen in der
//                      Palette: "therm" findet "Thermodynamik"); nicht hinter NOT
//   Rest-Zeichen       innerhalb eines Worts trennen (Remote-MCP -> Phrase "remote mcp")
//
// EINFACHE Anfragen (keine Operatoren, keine Anfuehrungszeichen, keine Klammern, kein *):
//   jedes Wort ab PRAEFIX_AB Zeichen ist Wortanfang. FTS5 (unicode61) kennt kein Stemming –
//   "Prüfung Termin" faende sonst weder "Prüfungen" noch "Termine". Kurze Woerter (der, im, an)
//   bleiben exakt, sonst traefen sie halbe Woerterbuecher. Wer exakt suchen will, setzt
//   Anfuehrungszeichen – ab dem ersten Syntaxzeichen gilt nur noch, was dasteht.
//   Dieselbe Regel gilt fuer die bereinigte Suche nach einem Syntaxfehler.
//
// Jeder Suchbegriff wird in "…" ausgegeben und enthaelt nur Buchstaben/Ziffern – FTS5-
// Sonderzeichen aus der Eingabe (^ : + - NEAR …) koennen den Ausdruck nicht mehr brechen.
// Ist die Eingabe syntaktisch kaputt (offenes ", offene Klammer, Operator ohne Operand),
// gibt es KEINEN Fehler, sondern die bereinigte Suche: alle Woerter mit AND (fallback: true).

const WORT = /[\p{L}\p{N}]+/gu;
const OPERATOREN = new Set(['AND', 'OR', 'NOT']);
const woerter = (s) => (String(s).match(WORT) || []).map(w => w.toLowerCase());
// Ab so vielen Zeichen ist ein Wort einer einfachen Anfrage automatisch Wortanfang.
export const PRAEFIX_AB = 4;
const langGenug = (w) => [...w].length >= PRAEFIX_AB;

// Eingabe in Tokens zerlegen. null = Syntaxfehler (offenes Anfuehrungszeichen).
// Token: { t: 'term', words, prefix, quoted } | { t: 'op', op } | { t: '(' } | { t: ')' }
function tokenize(q) {
  const out = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"') {
      const zu = q.indexOf('"', i + 1);
      if (zu < 0) return null;
      const words = woerter(q.slice(i + 1, zu));
      i = zu + 1;
      const prefix = q[i] === '*';
      if (prefix) i++;
      if (words.length) out.push({ t: 'term', words, prefix, quoted: true });
      continue;
    }
    if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
    let j = i;
    while (j < q.length && !/[\s"()]/.test(q[j])) j++;
    const chunk = q.slice(i, j);
    i = j;
    if (OPERATOREN.has(chunk)) { out.push({ t: 'op', op: chunk }); continue; }
    const words = woerter(chunk);
    if (words.length) out.push({ t: 'term', words, prefix: chunk.endsWith('*'), quoted: false });
  }
  return out;
}

// Grammatik pruefen: Operand (Operator Operand)*, Klammern balanciert und nicht leer.
function gueltig(tokens) {
  let erwartetOperand = true, tiefe = 0;
  for (const tok of tokens) {
    if (tok.t === 'term') { erwartetOperand = false; continue; }
    if (tok.t === '(') { tiefe++; erwartetOperand = true; continue; }
    if (tok.t === ')') { if (erwartetOperand || --tiefe < 0) return false; continue; }
    if (erwartetOperand) return false;            // Operator am Anfang / doppelt / nach "("
    erwartetOperand = true;
  }
  return !erwartetOperand && tiefe === 0;
}

const alsTerm = (t) => `"${t.words.join(' ')}"${t.prefix ? '*' : ''}`;

// Bereinigte Suche: alle Woerter der Eingabe (ohne die Operator-Woerter), mit AND verknuepft,
// Wortanfang wie bei einer einfachen Anfrage (ab PRAEFIX_AB Zeichen + letztes Wort).
// Dient als Rueckfall bei Syntaxfehlern.
export function fallbackFtsQuery(q) {
  const ws = (String(q ?? '').match(WORT) || []).filter(w => !OPERATOREN.has(w)).map(w => w.toLowerCase());
  if (!ws.length) return { match: null, terms: [], fallback: true };
  const match = ws.map((w, i) => `"${w}"${i === ws.length - 1 || langGenug(w) ? '*' : ''}`).join(' AND ');
  return { match, terms: [...new Set(ws)], fallback: true };
}

/**
 * Suchanfrage parsen.
 * @returns {{ match: string|null, terms: string[], fallback: boolean }}
 *   match    FTS5-MATCH-Ausdruck (null = nichts Suchbares in der Eingabe)
 *   terms    die POSITIVEN Suchwoerter (klein, ohne Operatoren und ohne NOT-Operanden) –
 *            die UI markiert damit die Treffer (R23), damit "OR"/"NOT x" nicht aufleuchten
 *   fallback true = Eingabe war syntaktisch kaputt, es lief die bereinigte Suche
 */
export function parseFtsQuery(q) {
  const s = String(q ?? '');
  const tokens = tokenize(s);
  if (!tokens || (tokens.length && !gueltig(tokens))) return fallbackFtsQuery(s);
  if (!tokens.length) return { match: null, terms: [], fallback: false };

  // Einfache Anfrage (nur Woerter): jedes Wort ab PRAEFIX_AB Zeichen ist Wortanfang. Bei einem
  // Bindestrich-Wort (Phrase) entscheidet das letzte Teilwort – nur das kann FTS5 als Praefix nehmen.
  if (!/["()*]/.test(s) && tokens.every(t => t.t === 'term')) {
    for (const t of tokens) if (langGenug(t.words[t.words.length - 1])) t.prefix = true;
  }

  // Letztes Wort ohne Anfuehrungszeichen = Wortanfang (nicht als NOT-Operand: das schloesse zu viel aus).
  const last = tokens[tokens.length - 1], vor = tokens[tokens.length - 2];
  if (last.t === 'term' && !last.quoted && !(vor && vor.t === 'op' && vor.op === 'NOT')) last.prefix = true;

  const teile = [], terms = [];
  let tiefe = 0, negAb = -1, negNaechster = false, prevOperand = false;
  for (const tok of tokens) {
    const istOperandStart = tok.t === 'term' || tok.t === '(';
    // FTS5 kennt das implizite AND nur zwischen Phrasen, nicht neben Klammern – und es bindet
    // dort staerker als NOT. Explizites AND ueberall = eine Rangfolge, keine Ueberraschungen.
    if (istOperandStart && prevOperand) teile.push('AND');
    if (tok.t === 'term') {
      teile.push(alsTerm(tok));
      if (negAb < 0 && !negNaechster) for (const w of tok.words) if (!terms.includes(w)) terms.push(w);
      negNaechster = false; prevOperand = true;
    } else if (tok.t === '(') {
      if (negNaechster && negAb < 0) negAb = tiefe;
      negNaechster = false; tiefe++; teile.push('('); prevOperand = false;
    } else if (tok.t === ')') {
      tiefe--; if (negAb === tiefe) negAb = -1;
      teile.push(')'); prevOperand = true;
    } else {
      teile.push(tok.op); negNaechster = tok.op === 'NOT'; prevOperand = false;
    }
  }
  return { match: teile.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')'), terms, fallback: false };
}

/** Nur der MATCH-Ausdruck (null = nichts Suchbares). */
export function buildFtsQuery(q) { return parseFtsQuery(q).match; }
