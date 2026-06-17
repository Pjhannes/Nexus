// src/vault-check.js
// ---------------------------------------------------------------------------
// Reine Vault-Gesundheits-Checks – KEINE FS-/DB-Zugriffe, KEIN Date.now().
// Der Aufrufer (src/tools.js -> MCP-Tool vault_check) liefert die bereits
// indizierten Notizen + die Liste aller Dateien; dieses Modul rechnet nur.
// Damit ist die Logik ohne MCP-Transport testbar (Projektregel R6) und es gibt
// genau EINE Quelle der Wahrheit fuer den Check.
//
// Checks (Logik aus dem fruehen scripts/vault-check.mjs, Session 49 portiert):
//   1. Kaputte Links      – Wikilinks/Embeds, die auf keine Datei aufloesen
//   2. Verwaiste Notizen  – aktive Top-Level-Notizen ohne eingehenden Link
//   3. Stale Dates        – aktualisiert:/stand: aelter als 30 Tage
//   4. Karteileichen      – Links auf bekannte tote Pfade/Namen
//   5. Doppelte Dateinamen– gleiche Basenames ausserhalb der Backup-Ordner
//
// Wikilink-/Frontmatter-Semantik stammt aus src/parse.js (parseNote); die
// Backlink-Aufloesung spiegelt das DB-Statement aus src/tools.js:
//   target == basename | title | pfad-ohne-ext.
// ---------------------------------------------------------------------------

const lc      = (s) => String(s).toLowerCase();
const baseOf  = (p) => p.split('/').pop();
const stripMd = (s) => s.replace(/\.md$/i, '');

// "Inaktive" Bereiche: kein lebender Wissensbereich -> aus ALLEN Checks raus.
// (gebuendelte Beispiel-Vaults + Nexus-Dev-Meta + eingefrorenes Controlling-Archiv;
//  bei Bedarf hier erweitern/kuerzen.)
const INACTIVE_AREAS = [
  'Nexus Anwendung/',
  'Projekt Vault-App/',
  'Arbeit/Controlling Liste/Archiv bis 2025/',
];
const inInactiveArea = (p) => INACTIVE_AREAS.some(a => p.startsWith(a));

const isActive = (p) =>
  !inInactiveArea(p) &&
  !p.includes('/Dateien/') &&
  !p.startsWith('_Konversationen/') &&
  !p.startsWith('_System/Archiv/') &&
  !p.startsWith('_System/Templates/');

const isBackupPath = (p) =>
  inInactiveArea(p) ||
  p.includes('/Dateien/') ||
  p.includes('/_old/') ||
  /\/dienstPC_/.test(p) ||
  /\/CatGirl\//.test(p) ||
  /\/_Prüfung\//.test(p) ||
  /\/Joachim\//.test(p) ||
  /\/LKM_\d/.test(p) ||
  /\/julie\//.test(p);

// Relativer Pfad, unter dem der Bericht im Vault landet (auch fuer den Aufrufer).
export const REPORT_REL = '_System/Vault-Check.md';
const SELF_SCRIPT = '_System/Scripts/vault_check.md';
// Meta-/generierte Dateien: Link-Beispiele bzw. generierte Linkliste -> nie selbst
// als Treffer (kaputte Links / Karteileichen / Orphan).
const isMetaFile = (p) => p === SELF_SCRIPT || p === REPORT_REL;

const STALE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const toTime = (c) => (c instanceof Date ? c.getTime() : Date.parse(String(c)));

const deadPathPrefixes = ['raw-sources/', '_System/Logs/'];
const deadNames = ['00 – Vault-Index'];

/**
 * @param {object}   input
 * @param {Array}    input.notes        – [{ path, basename, pathNoExt, title, fm, links:[target] }]
 * @param {string[]} input.allRelPaths  – ALLE Dateien (posix-rel, inkl. Anhaenge)
 * @param {number}   input.now          – Zeitstempel in ms (Date.now()) fuer Stale-Cutoff
 * @returns {{brokenLinks:Array, orphans:string[], staleDates:Array, deadRefs:Array, duplicates:Array}}
 */
export function runVaultCheck({ notes, allRelPaths, now }) {
  // --- Aufloesungs-Indizes (case-insensitiv wie Windows-FS/Obsidian) -------
  const noteKeys = new Set();
  for (const n of notes) { noteKeys.add(lc(n.basename)); noteKeys.add(lc(n.title)); noteKeys.add(lc(n.pathNoExt)); }
  // Beliebige Datei (auch Bild/PDF) loest auf -> Attachment-Embeds gelten nicht als "broken".
  const fileKeys = new Set();
  for (const rel of allRelPaths) {
    fileKeys.add(lc(rel));                  // voller relativer Pfad inkl. Endung
    fileKeys.add(lc(baseOf(rel)));          // Dateiname mit Endung
    fileKeys.add(lc(stripMd(rel)));         // Pfad ohne .md
    fileKeys.add(lc(stripMd(baseOf(rel)))); // Dateiname ohne .md
  }
  const resolves = (t) => { const k = lc(t); return noteKeys.has(k) || fileKeys.has(k); };

  const linkedTargets = new Set();
  for (const n of notes) for (const t of n.links) linkedTargets.add(lc(t));
  const isLinked = (n) => linkedTargets.has(lc(n.basename)) || linkedTargets.has(lc(n.title)) || linkedTargets.has(lc(n.pathNoExt));

  // --- 1. Kaputte Links ----------------------------------------------------
  const brokenLinks = [];
  for (const n of notes) {
    if (!isActive(n.path) || isMetaFile(n.path)) continue;
    for (const t of n.links) if (!resolves(t)) brokenLinks.push({ file: n.path, link: t });
  }

  // --- 2. Verwaiste Notizen ------------------------------------------------
  const orphans = [];
  for (const n of notes) {
    if (!isActive(n.path) || isMetaFile(n.path) || n.path === 'START.md') continue;
    if (/00 – (Index|Übersicht|Tracker)/.test(baseOf(n.path))) continue;
    if (!isLinked(n)) orphans.push(n.path);
  }

  // --- 3. Stale Dates ------------------------------------------------------
  const staleDates = [];
  const cutoff = now - STALE_DAYS * DAY_MS;
  for (const n of notes) {
    if (!isActive(n.path)) continue;
    const fm = n.fm || {};
    const candidates = [fm.aktualisiert, fm.stand, fm['zuletzt-aktualisiert']].filter(Boolean);
    for (const c of candidates) {
      const d = toTime(c);
      if (!isNaN(d) && d < cutoff) {
        staleDates.push({ file: n.path, value: String(c).slice(0, 10), days: Math.floor((now - d) / DAY_MS) });
        break;
      }
    }
  }

  // --- 4. Karteileichen ----------------------------------------------------
  const deadRefs = [];
  for (const n of notes) {
    if (!isActive(n.path)) continue;
    if (isMetaFile(n.path) || n.path === '_System/Arbeitsweise.md') continue;
    const hits = [];
    for (const t of n.links) {
      if (deadPathPrefixes.some(p => t.startsWith(p))) hits.push(t);
      if (deadNames.includes(baseOf(t))) hits.push(t);
    }
    if (hits.length) deadRefs.push({ file: n.path, hits });
  }

  // --- 5. Doppelte Dateinamen ----------------------------------------------
  const byBase = new Map();
  for (const n of notes) {
    if (isBackupPath(n.path)) continue;
    if (/^00 – /.test(n.basename)) continue;
    if (!byBase.has(n.basename)) byBase.set(n.basename, []);
    byBase.get(n.basename).push(n.path);
  }
  const duplicates = [...byBase.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({ name, paths }));

  return { brokenLinks, orphans, staleDates, deadRefs, duplicates };
}

function localDate(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Rendert das Ergebnis als Vault-Notiz (Markdown). Pure – nimmt den Zeitstempel
 * und die Zaehler vom Aufrufer.
 */
export function renderReport(result, { now, notesCount, filesCount, cap = 50 }) {
  const { brokenLinks, orphans, staleDates, deadRefs, duplicates } = result;
  const today = localDate(now);

  const md = ['---', 'typ: vault-check', `aktualisiert: ${today}`, 'tags: [system, vault-check]', '---', '',
    `# 🩺 Vault-Check – ${today}`, '',
    '> Automatisch generiert vom MCP-Tool `vault_check` (src/vault-check.js).', '',
    '## Zusammenfassung', '',
    '| Check | Treffer | Status |', '|---|---|---|',
    `| Kaputte Links | ${brokenLinks.length} | ${brokenLinks.length === 0 ? '✅' : '🔴'} |`,
    `| Verwaiste Notizen | ${orphans.length} | ${orphans.length <= 5 ? '✅' : '⚠️'} |`,
    `| Stale Dates (>30 Tage) | ${staleDates.length} | ${staleDates.length <= 10 ? '✅' : '⚠️'} |`,
    `| Karteileichen | ${deadRefs.length} | ${deadRefs.length === 0 ? '✅' : '🔴'} |`,
    `| Doppelte Dateinamen | ${duplicates.length} | ${duplicates.length === 0 ? '✅' : 'ℹ️'} |`, ''];

  const section = (title, items, render) => {
    md.push(`## ${title}`, '');
    if (!items.length) md.push('_Keine Treffer._');
    else items.slice(0, cap).forEach(i => md.push(render(i)));
    if (items.length > cap) md.push(`\n_(+${items.length - cap} weitere)_`);
    md.push('');
  };
  section('🔴 Kaputte Links', brokenLinks, b => `- [[${b.file}]] → \`${b.link}\``);
  section('🟡 Verwaiste Notizen (kein eingehender Link)', orphans, p => `- [[${p}]]`);
  section('🟡 Stale Dates', staleDates, s => `- [[${s.file}]] – ${s.value} (${s.days} Tage alt)`);
  section('🔴 Karteileichen', deadRefs, r => `- [[${r.file}]] – ${r.hits.join(', ')}`);
  section('ℹ️ Doppelte Dateinamen', duplicates, d => `- **${d.name}**: ${d.paths.map(p => '`' + p + '`').join(', ')}`);
  md.push('---');
  md.push(`*Bericht generiert: ${new Date(now).toLocaleString('de-DE')} · ${notesCount} Notizen, ${filesCount} Dateien gescannt*`);
  return md.join('\n');
}
