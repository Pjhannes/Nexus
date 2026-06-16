#!/usr/bin/env node
// safe-edit.mjs — der EINZIGE sanktionierte Weg, public/index.html zu aendern.
//
// Hintergrund (siehe STATUS.md): Die wiederkehrende "Edit-Tool zerschneidet
// index.html"-Katastrophe ist in Wahrheit ein Read-Modify-Write ueber den
// divergierenden Windows<->Linux-Mount: mal liest ein Tool eine veraltete/
// abgeschnittene Mount-Fassung und schreibt sie nach Windows zurueck, mal
// padded der Mount mit NUL. Edit zu verbieten behandelt nur ein Symptom.
//
// Dieser Editor macht die GANZE Fehlerklasse unmoeglich, egal welches Tool/Layer:
//   1. BASIS-CHECK   : Quelle muss VOR der Aenderung gesund sein (verifyHtml).
//                      -> editiert nie eine bereits korrupte/stale Datei
//                         (genau das war der Session-13-Unfall).
//   2. BACKUP        : Zeitgestempelte Kopie nach .nexus-backups/.
//   3. PATCH         : literale String-Replaces (split/join, KEIN Regex,
//                      kein $&/$1) mit exakter Count-Assertion je Anker.
//   4. ATOMIC WRITE  : in <file>.nexustmp schreiben, dann ueber das Ziel renamen.
//   5. READ-BACK     : Datei frisch von Platte lesen, sha256 muss == Soll sein.
//                      -> faengt Mount-Write-Back-Korruption / NUL-Padding.
//   6. ERGEBNIS-CHECK: verifyHtml auf das Resultat (Sentinel + node --check).
//   7. ROLLBACK      : schlaegt 5 oder 6 fehl -> Backup zurueckspielen + erneut
//                      read-back-verifizieren, Exit 1. Die kanonische Datei
//                      bleibt damit IMMER gesund oder unveraendert.
//
// AM SICHERSTEN lokal auf dem Windows-PC ausfuehren (dann gar kein Mount im Spiel).
// In der Sandbox schuetzt der Read-Back-Hash (Schritt 5) trotzdem zuverlaessig.
//
// Nutzung:
//   node scripts/safe-edit.mjs <datei> --patches <patches.json>
//   node scripts/safe-edit.mjs <datei> --content <neuerinhalt.txt>
//
// patches.json:  [ { "old": "...", "new": "...", "count": 1 }, ... ]
//   count optional (Default 1). old muss exakt count-mal vorkommen, sonst Abbruch.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, basename, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyHtml } from './verify-html.mjs';

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const isHtml = (f) => ['.html', '.htm'].includes(extname(f).toLowerCase());

function die(msg) {
  console.error('[safe-edit] ABBRUCH: ' + msg);
  process.exit(1);
}

// Atomar schreiben + sofort von Platte zurueckpruefen. Wirft bei Hash-Mismatch.
function writeVerified(file, content) {
  const tmp = file + '.nexustmp';
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file); // Windows: MoveFileEx-Semantik -> ueberschreibt Ziel
  const back = readFileSync(file, 'utf8');
  if (sha(back) !== sha(content)) {
    throw new Error(`Read-Back-Hash weicht ab (Soll ${sha(content).slice(0,12)} / Ist ${sha(back).slice(0,12)}) — moegliche Mount-Korruption`);
  }
  return back;
}

function applyPatches(content, patches) {
  let out = content;
  patches.forEach((p, i) => {
    if (typeof p.old !== 'string' || typeof p.new !== 'string') {
      die(`Patch #${i + 1}: 'old' und 'new' muessen Strings sein.`);
    }
    const want = p.count ?? 1;
    const have = out.split(p.old).length - 1;
    if (have !== want) {
      die(`Patch #${i + 1}: Anker kommt ${have}x vor, erwartet ${want}x. Anker eindeutiger machen.\n  Anker: ${JSON.stringify(p.old.slice(0, 80))}${p.old.length > 80 ? '…' : ''}`);
    }
    out = out.split(p.old).join(p.new); // literal, kein Regex
  });
  return out;
}

function main() {
  const [, , file, mode, arg] = process.argv;
  if (!file || !mode || !arg) {
    die('Nutzung: node scripts/safe-edit.mjs <datei> --patches <json> | --content <txt>');
  }
  if (!existsSync(file)) die(`Datei nicht gefunden: ${file}`);

  // 1. BASIS-CHECK — niemals eine bereits korrupte/stale Datei editieren.
  const base = readFileSync(file, 'utf8');
  if (isHtml(file)) {
    const v = verifyHtml(base, { label: file });
    if (!v.ok) {
      die(`Basis-Datei ist bereits DEFEKT — keine Aenderung an kaputter Quelle.\n  ` + v.problems.join('\n  ') +
          `\n  -> Erst aus Git/Backup eine gesunde index.html herstellen, dann erneut editieren.`);
    }
  }

  // Neuen Inhalt bestimmen.
  let next;
  if (mode === '--patches') {
    let patches;
    try { patches = JSON.parse(readFileSync(arg, 'utf8')); }
    catch (e) { die(`Patches-JSON nicht lesbar: ${e.message}`); }
    if (!Array.isArray(patches) || patches.length === 0) die('Patches-JSON muss ein nicht-leeres Array sein.');
    next = applyPatches(base, patches);
    if (next === base) die('Patches haben nichts veraendert (old == new?).');
  } else if (mode === '--content') {
    next = readFileSync(arg, 'utf8');
  } else {
    die(`Unbekannter Modus '${mode}'. Erlaubt: --patches | --content`);
  }

  // Ergebnis VOR dem Schreiben pruefen (spart unnoetiges Backup/Write bei kaputtem Patch-Resultat).
  if (isHtml(file)) {
    const v = verifyHtml(next, { label: file });
    if (!v.ok) {
      die('Patch-RESULTAT waere defekt — nicht geschrieben:\n  ' + v.problems.join('\n  '));
    }
  }

  // 2. BACKUP
  const backupsDir = join(dirname(file), '..', '.nexus-backups');
  mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(backupsDir, `${basename(file)}.${stamp}.bak`);
  copyFileSync(file, backup);

  // 3.-6. ATOMIC WRITE + READ-BACK + ERGEBNIS-CHECK
  try {
    const back = writeVerified(file, next);
    if (isHtml(file)) {
      const v = verifyHtml(back, { label: file });
      if (!v.ok) throw new Error('Ergebnis-Check nach Schreiben fehlgeschlagen:\n  ' + v.problems.join('\n  '));
    }
    console.log(`[safe-edit] OK — ${file} aktualisiert.`);
    console.log(`            ${back.split('\n').length} Zeilen, ${Buffer.byteLength(back,'utf8')} Bytes, sha ${sha(back).slice(0,12)}`);
    console.log(`            Backup: ${backup}`);
    console.log(`            Bitte zusaetzlich per Windows-Read Kopf+Ende gegenpruefen.`);
  } catch (e) {
    // 7. ROLLBACK
    console.error('[safe-edit] FEHLER beim Schreiben/Pruefen: ' + e.message);
    try {
      const good = readFileSync(backup, 'utf8');
      const restored = writeVerified(file, good);
      if (sha(restored) !== sha(good)) throw new Error('Rollback-Read-Back-Hash weicht ab');
      console.error('[safe-edit] ROLLBACK erfolgreich — Datei ist wieder im Ausgangszustand.');
    } catch (re) {
      console.error('[safe-edit] ROLLBACK FEHLGESCHLAGEN: ' + re.message);
      console.error('[safe-edit] Gesunde Kopie liegt unter: ' + backup);
    }
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
