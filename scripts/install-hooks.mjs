#!/usr/bin/env node
// install-hooks.mjs — aktiviert den versionierten Git-Hook-Pfad (scripts/hooks).
// Wird automatisch von npm via "prepare" nach jedem `npm install` ausgefuehrt,
// laesst sich aber auch manuell starten:  node scripts/install-hooks.mjs
//
// Setzt core.hooksPath, sodass scripts/hooks/pre-commit (Truncation-Schutz fuer
// index.html) ohne weiteren Handgriff aktiv ist. Idempotent und fehlertolerant:
// scheitert NICHT den Install, falls kein Git-Repo vorliegt (z.B. im Tarball).

import { execFileSync } from 'node:child_process';

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' });
} catch {
  console.log('[install-hooks] kein Git-Repo — uebersprungen.');
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', 'scripts/hooks'], { stdio: 'pipe' });
  console.log('[install-hooks] core.hooksPath = scripts/hooks aktiv (pre-commit Truncation-Schutz).');
} catch (e) {
  console.warn('[install-hooks] Konnte core.hooksPath nicht setzen: ' + e.message);
}
