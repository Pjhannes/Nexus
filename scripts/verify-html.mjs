#!/usr/bin/env node
// verify-html.mjs — Integritaetspruefer fuer public/index.html (und andere HTML-Dateien).
//
// Zweck: erkennt JEDE der historisch aufgetretenen index.html-"Truncations"
// (Datei mitten im Inline-<script> abgeschnitten, Schluss-Tags weg, NUL-Padding
// durch Mount-Divergenz). Die zwei harten Detektoren sind:
//   1. Datei endet mit </html> (Sentinel)  -> faengt fehlende Schluss-Tags
//   2. node --check des Inline-<script>     -> faengt unbalancierte Klammern
// Beides schlaegt bei jeder bisher dokumentierten Truncation an.
//
// Exit 0 = gesund, Exit 1 = defekt. Keine Dependencies, laeuft auf Windows und Linux.
//
// Nutzung:  node scripts/verify-html.mjs [public/index.html]

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SENTINEL = '</html>';
const MIN_BYTES = 30_000; // index.html ist ~116 KB; nur grobe Truncation soll feuern
const MIN_LINES = 500;    // dito; Sentinel + node --check sind die eigentlichen Waechter
const NUL = String.fromCharCode(0);

export function verifyHtml(content, { label = 'HTML' } = {}) {
  const problems = [];

  if (content.includes(NUL)) {
    problems.push('NUL-Bytes gefunden (typisch fuer Mount-Korruption)');
  }

  if (!content.trimEnd().endsWith(SENTINEL)) {
    problems.push(`endet nicht mit ${SENTINEL} (Schluss-Tags fehlen -> Truncation?)`);
  }

  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes < MIN_BYTES) problems.push(`nur ${bytes} Bytes (< ${MIN_BYTES})`);

  const lines = content.split('\n').length;
  if (lines < MIN_LINES) problems.push(`nur ${lines} Zeilen (< ${MIN_LINES})`);

  // Inline-<script> extrahieren (index.html hat genau einen grossen Block) und syntaktisch pruefen.
  const open = content.indexOf('<script>');
  const close = content.lastIndexOf('</script>');
  if (open === -1 || close === -1 || close <= open) {
    problems.push('kein vollstaendiger <script> ... </script>-Block');
  } else {
    const script = content.slice(open + '<script>'.length, close);
    const tmp = join(tmpdir(), `nexus-verify-${process.pid}-${Date.now()}.js`);
    try {
      writeFileSync(tmp, script);
      execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    } catch (e) {
      const msg = (e.stderr?.toString() || e.message || '').split('\n').find(Boolean) || 'unbekannt';
      problems.push('node --check des Inline-Scripts fehlgeschlagen: ' + msg.trim());
    } finally {
      try { unlinkSync(tmp); } catch {}
    }
  }

  return { ok: problems.length === 0, problems, bytes, lines, label };
}

// --- CLI ---
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const file = process.argv[2] || 'public/index.html';
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch (e) {
    console.error(`[verify-html] kann ${file} nicht lesen: ${e.message}`);
    process.exit(1);
  }
  const r = verifyHtml(content, { label: file });
  if (r.ok) {
    console.log(`[verify-html] OK  ${file}: ${r.lines} Zeilen, ${r.bytes} Bytes, Inline-Script node --check gruen, Ende </html>.`);
    process.exit(0);
  }
  console.error(`[verify-html] DEFEKT  ${file}:`);
  for (const p of r.problems) console.error('  - ' + p);
  process.exit(1);
}
