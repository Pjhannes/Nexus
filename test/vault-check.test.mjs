// test/vault-check.test.mjs – Verifiziert die reine Pruef-Logik aus src/vault-check.js.
// Synthetische Notizen/Dateien, fixer Zeitstempel -> deterministisch, ohne FS/DB.
// Lauf: node test/vault-check.test.mjs
import { runVaultCheck, renderReport, REPORT_REL } from '../src/vault-check.js';

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label); fail++; }
}

// Hilfs-Notiz: path -> {path, basename, pathNoExt, title, fm, links}
function note(path, { title, fm = {}, links = [] } = {}) {
  const basename = path.split('/').pop().replace(/\.md$/i, '');
  return { path, basename, pathNoExt: path.replace(/\.md$/i, ''), title: title || basename, fm, links };
}

const NOW = Date.parse('2026-06-17T12:00:00');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

// ── 1. Kaputte Links ──────────────────────────────────────────────────────
{
  const notes = [
    note('A.md', { links: ['B', 'Fehlt'] }),   // B existiert, Fehlt nicht
    note('B.md'),
  ];
  const r = runVaultCheck({ notes, allRelPaths: ['A.md', 'B.md'], now: NOW });
  ok('Kaputter Link: nur "Fehlt"', r.brokenLinks.length === 1 && r.brokenLinks[0].link === 'Fehlt');
}
{
  // Attachment-Embed loest gegen die Datei-Liste auf -> NICHT broken.
  const notes = [note('A.md', { links: ['bild.png'] })];
  const r = runVaultCheck({ notes, allRelPaths: ['A.md', 'Anhang/bild.png'], now: NOW });
  ok('Attachment-Embed [[bild.png]] gilt als aufgeloest', r.brokenLinks.length === 0);
}
{
  // Case-insensitiv: [[b]] loest auf B.md auf.
  const notes = [note('A.md', { links: ['b'] }), note('B.md')];
  const r = runVaultCheck({ notes, allRelPaths: ['A.md', 'B.md'], now: NOW });
  ok('Link-Aufloesung ist case-insensitiv', r.brokenLinks.length === 0);
}

// ── 2. Verwaiste Notizen ──────────────────────────────────────────────────
{
  const notes = [
    note('START.md', { links: ['A'] }), // verlinkt A; selbst immer ausgenommen
    note('A.md', { links: ['B'] }),      // eingehend von START, verlinkt B
    note('B.md'),                        // hat eingehenden Link (von A)
    note('C.md'),                        // KEIN eingehender Link -> orphan
    note('Thema/00 – Übersicht.md'),     // 00 – Übersicht ausgenommen
    note(REPORT_REL),                    // generierter Bericht -> nie orphan
  ];
  const all = notes.map(n => n.path);
  const r = runVaultCheck({ notes, allRelPaths: all, now: NOW });
  ok('Orphan: nur C.md', r.orphans.length === 1 && r.orphans[0] === 'C.md');
  ok('Orphan: START.md ausgenommen', !r.orphans.includes('START.md'));
  ok('Orphan: Bericht-Notiz ausgenommen', !r.orphans.includes(REPORT_REL));
}

// ── 3. Stale Dates ────────────────────────────────────────────────────────
{
  const notes = [
    note('Alt.md',  { fm: { aktualisiert: daysAgo(40) } }),  // > 30 Tage
    note('Neu.md',  { fm: { aktualisiert: daysAgo(5) } }),   // frisch
    note('Stand.md',{ fm: { stand: daysAgo(60) } }),         // anderes Feld
  ];
  const all = notes.map(n => n.path);
  const r = runVaultCheck({ notes, allRelPaths: all, now: NOW });
  ok('Stale: Alt.md + Stand.md (nicht Neu.md)',
     r.staleDates.length === 2 && r.staleDates.some(s => s.file === 'Alt.md') && r.staleDates.some(s => s.file === 'Stand.md'));
  ok('Stale: Tage-Differenz berechnet', r.staleDates.find(s => s.file === 'Alt.md').days === 40);
}

// ── 4. Karteileichen ──────────────────────────────────────────────────────
{
  const notes = [
    note('A.md', { links: ['raw-sources/x', 'B'] }),     // toter Prefix
    note('C.md', { links: ['00 – Vault-Index'] }),       // toter Name
    note('B.md'),
  ];
  const all = ['A.md', 'B.md', 'C.md'];
  // R27b: tote Praefixe/Namen kommen aus der Config (vaultCheck.deadPrefixes / deadNames).
  const r = runVaultCheck({ notes, allRelPaths: all, now: NOW, regeln: { deadPrefixes: ['raw-sources/'], deadNames: ['00 – Vault-Index'] } });
  ok('Karteileiche: toter Prefix raw-sources/ (aus Config)', r.deadRefs.some(d => d.file === 'A.md'));
  ok('Karteileiche: toter Name 00 – Vault-Index (aus Config)', r.deadRefs.some(d => d.file === 'C.md'));
  ok('ohne Config-Regel keine Karteileichen-Treffer', runVaultCheck({ notes, allRelPaths: all, now: NOW }).deadRefs.length === 0);
}

// ── 5. Doppelte Dateinamen ────────────────────────────────────────────────
{
  const notes = [
    note('Ordner1/Notiz.md'),
    note('Ordner2/Notiz.md'),            // gleicher Basename -> Duplikat
    note('Ordner3/Dateien/Notiz.md'),    // im Backup-Pfad -> zaehlt NICHT
    note('Einzig.md'),
  ];
  const all = notes.map(n => n.path);
  const r = runVaultCheck({ notes, allRelPaths: all, now: NOW });
  ok('Duplikat: "Notiz" mit genau 2 Pfaden (Backup ignoriert)',
     r.duplicates.length === 1 && r.duplicates[0].name === 'Notiz' && r.duplicates[0].paths.length === 2);
}

// ── Inaktive Bereiche raus aus ALLEN Checks ───────────────────────────────
{
  const notes = [note('Projekt Vault-App/Tot.md', { links: ['Gibtsnicht'] })];
  // R27b: inaktive Bereiche kommen aus der Config (regeln.inactiveAreas), nicht mehr aus dem Code.
  const r = runVaultCheck({ notes, allRelPaths: ['Projekt Vault-App/Tot.md'], now: NOW, regeln: { inactiveAreas: ['Projekt Vault-App/'] } });
  ok('Inaktiver Bereich (aus Config): kein broken/orphan',
     r.brokenLinks.length === 0 && r.orphans.length === 0);
  const r2 = runVaultCheck({ notes, allRelPaths: ['Projekt Vault-App/Tot.md'], now: NOW });
  ok('Ohne Config-Regel ist derselbe Bereich aktiv (broken link gemeldet)', r2.brokenLinks.length === 1);
  // ignoreNames: Segment exakt oder Praefix mit "*" -> zaehlt als Backup-Kopie (kein Duplikat-Treffer)
  const dup = [note('A/Skript.md'), note('Backups/LKM_2024/Skript.md'), note('CatGirl/Skript.md')];
  const r3 = runVaultCheck({ notes: dup, allRelPaths: dup.map(n => n.path), now: NOW, regeln: { ignoreNames: ['CatGirl', 'LKM_*'] } });
  ok('ignoreNames: Backup-Kopien erzeugen keine Duplikat-Treffer', r3.duplicates.length === 0, JSON.stringify(r3.duplicates));
  const r4 = runVaultCheck({ notes: dup, allRelPaths: dup.map(n => n.path), now: NOW });
  ok('ohne ignoreNames werden die Kopien als Duplikate gemeldet', r4.duplicates.length >= 1);
}

// ── renderReport: gueltige Notiz mit Frontmatter ──────────────────────────
{
  const r = runVaultCheck({ notes: [note('A.md', { links: ['Fehlt'] })], allRelPaths: ['A.md'], now: NOW });
  const md = renderReport(r, { now: NOW, notesCount: 1, filesCount: 1 });
  ok('Report: Frontmatter typ: vault-check', md.startsWith('---\ntyp: vault-check'));
  ok('Report: Zusammenfassungs-Tabelle vorhanden', md.includes('## Zusammenfassung') && md.includes('| Kaputte Links | 1 |'));
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
