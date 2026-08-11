// src/lernen.js – R26: Lernmodus (Karteikarten + Spaced Repetition)
//
// ZWEI getrennte Datenschichten, bewusst NICHT in der SQLite-Index-DB:
//
//   1. INHALT     <Notiz>.karten.json neben der Notiz (wie .vortrag.json).
//                 Schreibt write_karten (MCP) bzw. der Karten-Editor der App.
//   2. LERNSTAND  _System/Lernen/log/<JJJJ-MM>.jsonl, append-only. Der Zustand je
//                 Karte (Intervall, Faelligkeit) wird aus dem Log GEFALTET und nie
//                 separat gespeichert.
//
// Warum getrennt und warum im Vault statt in der DB:
//   * db.js droppt notes/headings/links/notes_fts bei SCHEMA_VERSION-Bump und der
//     Index wird bei jedem Start neu gebaut – er ist ein Wegwerf-Cache. Lernstand
//     darf dort nicht liegen.
//   * Der Vault wird per Syncthing synchronisiert. Append-only-JSONL erzeugt viel
//     seltener Konflikte als eine staendig neu geschriebene Zustandsdatei; taucht
//     doch eine *.sync-conflict*-Kopie auf, liest readReviews sie mit und
//     dedupliziert (siehe unten) statt Antworten zu verlieren.
//   * Getrennte Dateien heissen: ein neu generiertes Kartenset kann den Lernstand
//     nicht zerstoeren. Zusaetzlich erben unveraenderte Fragen ihre alte ID
//     (mergeKartenIds) – nur so ueberlebt der Fortschritt eine Regeneration.
import {
  readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync,
  existsSync, readdirSync, statSync,
} from 'fs';
import { join, resolve, sep, dirname } from 'path';
import { randomBytes } from 'node:crypto';
import { vortragNorm, ohneFrontmatter } from './norm.js';

export const KARTEN_VERSION = 1;
export const KARTEN_TYPEN = ['janein', 'mc', 'freitext', 'bild'];
// Verfahren-Kennung im Uebersichts-Payload: macht spaeteres Umstellen auf FSRS
// sichtbar, ohne dass die UI raten muss, wie gerechnet wurde.
export const LERN_VERFAHREN = 'stufen-v1';

// Wiederholungsleiter in Tagen: auf Anhieb richtig = eine Stufe weiter.
// Nach der letzten Stufe gilt die Karte als durch (keine Wiederholung mehr).
export const LERN_STUFEN = Object.freeze([1, 3, 5, 7]);

export const LERN_DIR    = '_System/Lernen';
export const LERN_LOGDIR = '_System/Lernen/log';
export const FAECHER_REL = '_System/Lernen/faecher.json';

// Standardwerte, falls ein Fach nichts eigenes setzt (UI: Einstellungen -> Lernen).
export const LERN_STANDARD = { zielKorrekt: 3, neueProTag: 20 };

// Obergrenzen: kein Sicherheitsthema (lokaler Client), aber ein LLM-Ausreisser soll
// keine Monster-JSON erzeugen, die die Lernsitzung unbrauchbar macht.
const MAX_KARTEN      = 300;    // 2026-08-09 von 100 angehoben: ganze Skripte brauchen mehr
const MAX_FRAGE       = 500;
const MAX_ANTWORT     = 2000;
const MAX_OPTION      = 300;
const MAX_OPTIONEN    = 8;
const MIN_OPTIONEN    = 2;
const MAX_ERKLAERUNG  = 1000;
const MAX_QUELLE      = 400;
const MAX_THEMA       = 80;     // Kapitel/Abschnitt innerhalb einer Notiz
const MAX_LABELS      = 12;
const MIN_LABELS      = 2;
const MAX_LABEL       = 80;
const MIN_RADIUS      = 0.02;   // altes Kreis-Format, weiterhin lesbar
const MAX_RADIUS      = 0.4;
const MIN_SEITE       = 0.01;   // kleinste Kantenlaenge eines Rechtecks (Anteil)

// Wie eine Bild-Karte abgefragt wird: Begriff aus der Liste zuordnen oder eintippen.
export const BILD_MODI = ['zuordnen', 'tippen'];
const BILD_EXT = /\.(png|jpe?g|webp|gif|svg|bmp|avif)$/i;

// Obergrenze fuer das Wiederholungsintervall (10 Jahre). Ohne Deckel waechst es
// exponentiell weiter und sprengt nach ~40 richtigen Antworten den Date-Bereich –
// "in 200 Jahren wieder abfragen" ist ohnehin dasselbe wie "nie".
const MAX_INTERVALL = 3650;

const IGNORE_DIRS = new Set(['.obsidian', '.trash', '.nexus', 'node_modules', '.git', '.stfolder']);

// ══════════════════════════════════════════════════════════════════════════════
// Pfade
// ══════════════════════════════════════════════════════════════════════════════

export function kartenSidecarPath(notePath) {
  return notePath.replace(/\.md$/i, '.karten.json');
}

// Umkehrung – die WAHRE Notiz-Zuordnung. Bewusst nicht das Feld "notiz" im JSON:
// nach einem move() zieht der Sidecar mit, das Feld im JSON bliebe aber auf dem
// alten Pfad stehen. Der Dateiname ist immer aktuell.
export function notizAusSidecarPath(sidecarPath) {
  return sidecarPath.replace(/\.karten\.json$/i, '.md');
}

// ══════════════════════════════════════════════════════════════════════════════
// Validierung (pure) – Fehlerliste im Stil von validateVortragSegmente:
// jede Meldung nennt die Karte, damit das LLM gezielt nachbessern kann.
// ══════════════════════════════════════════════════════════════════════════════

function istText(v) { return typeof v === 'string' && v.trim().length > 0; }

export function validateKarten(karten, noteContent, opts = {}) {
  const bildExists = typeof opts.bildExists === 'function' ? opts.bildExists : () => true;
  const errors = [];
  if (!Array.isArray(karten) || karten.length === 0) {
    errors.push('karten fehlt oder ist leer');
    return errors;
  }
  if (karten.length > MAX_KARTEN) {
    errors.push(`zu viele Karten (${karten.length}, max ${MAX_KARTEN})`);
    return errors;
  }
  const typen = new Set(KARTEN_TYPEN);
  const norm = vortragNorm(noteContent);
  const gesehen = new Map(); // normalisierte Frage -> 1-basierte Kartennummer

  karten.forEach((k, i) => {
    const typ = k && typeof k.typ === 'string' ? k.typ : '';
    const nr = `Karte ${i + 1}` + (typ ? ` (${typ})` : '');
    if (!k || typeof k !== 'object') { errors.push(`${nr}: kein Objekt`); return; }
    if (!typen.has(typ)) {
      errors.push(`${nr}: unbekannter typ "${k.typ}" (erlaubt: ${KARTEN_TYPEN.join('|')})`);
      return;
    }
    if (!istText(k.frage)) { errors.push(`${nr}: "frage" fehlt oder ist leer`); return; }
    if (k.frage.length > MAX_FRAGE) {
      errors.push(`${nr}: "frage" zu lang (${k.frage.length} Zeichen, max ${MAX_FRAGE})`);
      return;
    }
    const nf = vortragNorm(k.frage);
    if (gesehen.has(nf)) {
      errors.push(`${nr}: gleiche Frage wie Karte ${gesehen.get(nf)} – doppelte Karten weglassen`);
      return;
    }
    gesehen.set(nf, i + 1);

    // Thema = Kapitel/Abschnitt innerhalb der Notiz. Optional, aber die Grundlage der
    // zweistufigen Auswahl im Lernmodus (Lernset aufklappen -> Themen darunter).
    if (k.thema !== undefined && k.thema !== null && k.thema !== '') {
      if (typeof k.thema !== 'string') { errors.push(`${nr}: "thema" muss Text sein`); return; }
      if (k.thema.trim().length > MAX_THEMA) {
        errors.push(`${nr}: "thema" zu lang (${k.thema.trim().length} Zeichen, max ${MAX_THEMA})`);
        return;
      }
    }

    if (k.erklaerung !== undefined && k.erklaerung !== null) {
      if (typeof k.erklaerung !== 'string') { errors.push(`${nr}: "erklaerung" muss Text sein`); return; }
      if (k.erklaerung.length > MAX_ERKLAERUNG) {
        errors.push(`${nr}: "erklaerung" zu lang (${k.erklaerung.length} Zeichen, max ${MAX_ERKLAERUNG})`);
        return;
      }
    }

    // Grounding: "quelle" ist ein WOERTLICHES Zitat aus der Notiz, das die Antwort
    // belegt – dieselbe Containment-Pruefung wie beim Vortrags-Anker. Pflicht ausser
    // bei Bild-Karten (dort steht die Antwort im Bild, nicht im Text).
    // Bewusst NICHT validiert: mc-Optionen. Distraktoren muessen frei erfindbar sein,
    // sonst waeren sie alle woertlich in der Notiz und damit didaktisch wertlos.
    const quellePflicht = typ !== 'bild';
    if (quellePflicht || k.quelle !== undefined) {
      if (!istText(k.quelle)) {
        errors.push(`${nr}: "quelle" fehlt – kurzes woertliches Zitat aus der Notiz angeben, das die Antwort belegt`);
        return;
      }
      if (k.quelle.length > MAX_QUELLE) {
        errors.push(`${nr}: "quelle" zu lang (${k.quelle.length} Zeichen, max ${MAX_QUELLE}) – kurzen, eindeutigen Ausschnitt waehlen`);
        return;
      }
      const nq = vortragNorm(k.quelle);
      if (!nq) {
        errors.push(`${nr}: quelle besteht nur aus Markdown-Markern/Leerraum: "${k.quelle.slice(0, 40)}"`);
        return;
      }
      if (!norm.includes(nq)) {
        errors.push(`${nr}: quelle nicht woertlich in der Notiz gefunden: "${k.quelle.slice(0, 80)}"`);
        return;
      }
    }

    if (typ === 'janein') {
      if (typeof k.antwort !== 'boolean') {
        errors.push(`${nr}: "antwort" muss true oder false sein`);
      }
      return;
    }

    if (typ === 'freitext') {
      if (!istText(k.antwort)) { errors.push(`${nr}: "antwort" (Musterloesung) fehlt`); return; }
      if (k.antwort.length > MAX_ANTWORT) {
        errors.push(`${nr}: "antwort" zu lang (${k.antwort.length} Zeichen, max ${MAX_ANTWORT})`);
      }
      return;
    }

    if (typ === 'mc') {
      if (!Array.isArray(k.optionen) || k.optionen.length < MIN_OPTIONEN || k.optionen.length > MAX_OPTIONEN) {
        errors.push(`${nr}: "optionen" braucht ${MIN_OPTIONEN}-${MAX_OPTIONEN} Eintraege`);
        return;
      }
      const seenOpt = new Map();
      for (let j = 0; j < k.optionen.length; j++) {
        const o = k.optionen[j];
        if (!istText(o)) { errors.push(`${nr}: Option ${j + 1} ist leer`); return; }
        if (o.length > MAX_OPTION) {
          errors.push(`${nr}: Option ${j + 1} zu lang (${o.length} Zeichen, max ${MAX_OPTION})`);
          return;
        }
        const no = vortragNorm(o);
        if (seenOpt.has(no)) {
          errors.push(`${nr}: Option ${j + 1} ist identisch mit Option ${seenOpt.get(no)}`);
          return;
        }
        seenOpt.set(no, j + 1);
      }
      if (!Array.isArray(k.korrekt) || k.korrekt.length === 0) {
        errors.push(`${nr}: "korrekt" fehlt – Indizes der richtigen Optionen (0-basiert)`);
        return;
      }
      const seenIdx = new Set();
      for (const idx of k.korrekt) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= k.optionen.length) {
          errors.push(`${nr}: korrekt-Index ${idx} liegt ausserhalb von 0..${k.optionen.length - 1}`);
          return;
        }
        if (seenIdx.has(idx)) { errors.push(`${nr}: korrekt-Index ${idx} doppelt`); return; }
        seenIdx.add(idx);
      }
      if (seenIdx.size === k.optionen.length) {
        errors.push(`${nr}: alle Optionen sind korrekt – mindestens eine falsche Option (Distraktor) noetig`);
      }
      return;
    }

    // typ === 'bild'
    if (!istText(k.bild)) { errors.push(`${nr}: "bild" fehlt – Vault-Pfad der Grafik angeben`); return; }
    if (!BILD_EXT.test(k.bild)) {
      errors.push(`${nr}: "bild" ist keine Bilddatei: "${k.bild}" (png/jpg/jpeg/webp/gif/svg/bmp/avif)`);
      return;
    }
    if (!bildExists(k.bild)) {
      errors.push(`${nr}: Bild nicht im Vault gefunden: "${k.bild}" – Pfad relativ zur Vault-Wurzel angeben`);
      return;
    }
    if (!Array.isArray(k.labels) || k.labels.length < MIN_LABELS || k.labels.length > MAX_LABELS) {
      errors.push(`${nr}: "labels" braucht ${MIN_LABELS}-${MAX_LABELS} zuzuordnende Begriffe`);
      return;
    }
    const seenLab = new Map();
    for (let j = 0; j < k.labels.length; j++) {
      const l = k.labels[j];
      if (!istText(l)) { errors.push(`${nr}: Label ${j + 1} ist leer`); return; }
      if (l.length > MAX_LABEL) {
        errors.push(`${nr}: Label ${j + 1} zu lang (${l.length} Zeichen, max ${MAX_LABEL})`);
        return;
      }
      const nl = vortragNorm(l);
      if (seenLab.has(nl)) { errors.push(`${nr}: Label ${j + 1} ist identisch mit Label ${seenLab.get(nl)}`); return; }
      seenLab.set(nl, j + 1);
    }
    if (k.modus !== undefined && k.modus !== null && !BILD_MODI.includes(k.modus)) {
      errors.push(`${nr}: "modus" muss ${BILD_MODI.join(' oder ')} sein`);
      return;
    }
    // Regionen darf Claude selbst setzen (es kann die Bilddatei ansehen). Kommen keine
    // mit, platziert sie der Nutzer im Karten-Editor. Was da ist, muss aber stimmen.
    if (k.regionen !== undefined && k.regionen !== null) {
      if (!Array.isArray(k.regionen)) { errors.push(`${nr}: "regionen" muss eine Liste sein`); return; }
      const labelSet = new Set(k.labels.map(l => vortragNorm(l)));
      const seenReg = new Set();
      for (let j = 0; j < k.regionen.length; j++) {
        const r = k.regionen[j];
        const rn = `${nr}: Region ${j + 1}`;
        if (!r || typeof r !== 'object') { errors.push(`${rn} ist kein Objekt`); return; }
        const nl = vortragNorm(r.label);
        if (!nl || !labelSet.has(nl)) {
          errors.push(`${rn}: label "${r.label}" kommt nicht in "labels" vor`);
          return;
        }
        if (seenReg.has(nl)) { errors.push(`${rn}: label "${r.label}" hat schon eine Region`); return; }
        seenReg.add(nl);
        for (const feld of ['x', 'y']) {
          if (typeof r[feld] !== 'number' || !(r[feld] >= 0 && r[feld] <= 1)) {
            errors.push(`${rn}: "${feld}" muss eine Zahl zwischen 0 und 1 sein (0 = links/oben, 1 = rechts/unten)`);
            return;
          }
        }
        // Rechteck (x/y = linke obere Ecke, w/h = Groesse). Kreise mit "r" bleiben
        // lesbar, damit vor der Umstellung angelegte Karten weiter funktionieren.
        if (r.w !== undefined || r.h !== undefined) {
          for (const feld of ['w', 'h']) {
            if (typeof r[feld] !== 'number' || !(r[feld] >= MIN_SEITE && r[feld] <= 1)) {
              errors.push(`${rn}: "${feld}" muss zwischen ${MIN_SEITE} und 1 liegen (Anteil der Bildbreite bzw. -hoehe)`);
              return;
            }
          }
          if (r.x + r.w > 1.001 || r.y + r.h > 1.001) {
            errors.push(`${rn}: Rechteck ragt ueber den Bildrand hinaus (x+w bzw. y+h groesser als 1)`);
            return;
          }
        } else if (typeof r.r !== 'number' || !(r.r >= MIN_RADIUS && r.r <= MAX_RADIUS)) {
          errors.push(`${rn}: braucht "w" und "h" (Rechteck) – oder "r" zwischen ${MIN_RADIUS} und ${MAX_RADIUS} (altes Kreis-Format)`);
          return;
        }
      }
    }
  });
  return errors;
}

// Eine Bild-Karte ist erst spielbar, wenn JEDES Label eine Region hat – sonst
// koennte die Sitzung sie nicht auswerten. Der Rest ist immer spielbar.
export function karteSpielbar(k) {
  if (!k || k.typ !== 'bild') return true;
  const labels = Array.isArray(k.labels) ? k.labels : [];
  const regionen = Array.isArray(k.regionen) ? k.regionen : [];
  if (labels.length === 0) return false;
  const haben = new Set(regionen.map(r => vortragNorm(r?.label)));
  return labels.every(l => haben.has(vortragNorm(l)));
}

// ══════════════════════════════════════════════════════════════════════════════
// IDs / Merge
// ══════════════════════════════════════════════════════════════════════════════

export function neueKartenId() {
  return 'k' + randomBytes(5).toString('hex');
}

function saubereKarte(k) {
  const typ = k.typ;
  const out = { typ, frage: k.frage.trim() };
  if (typ === 'janein')   out.antwort = k.antwort === true;
  if (typ === 'freitext') out.antwort = String(k.antwort).trim();
  if (typ === 'mc') {
    out.optionen = k.optionen.map(o => String(o).trim());
    out.korrekt  = [...k.korrekt].sort((a, b) => a - b);
  }
  if (typ === 'bild') {
    out.bild   = k.bild.trim().replace(/\\/g, '/');
    out.labels = k.labels.map(l => String(l).trim());
    out.modus  = BILD_MODI.includes(k.modus) ? k.modus : 'zuordnen';
    // Standardmaessig deckt die Region ab, was auf der Folie steht – sonst waere die
    // Loesung schon aufgedruckt zu sehen. Nur bei echten Leerfolien abschaltbar.
    out.abdecken = k.abdecken !== false;
  }
  if (istText(k.thema))      out.thema = k.thema.trim();
  if (istText(k.quelle))     out.quelle = k.quelle.trim();
  if (istText(k.erklaerung)) out.erklaerung = k.erklaerung.trim();
  return out;
}

/**
 * Eine Region in Normalform bringen: Rechteck {label,x,y,w,h}. Kreise aus der Zeit
 * vor der Umstellung ({x,y,r} mit x/y als MITTELPUNKT) werden dabei in das
 * umschliessende Quadrat uebersetzt, damit alte Karten ohne Nacharbeit weiterlaufen.
 */
export function regionSauber(r, labels) {
  const label = (labels || []).find(l => vortragNorm(l) === vortragNorm(r?.label));
  if (!label) return null;
  if (typeof r.w === 'number' && typeof r.h === 'number') {
    return { label, x: klemm(r.x), y: klemm(r.y), w: klemm(r.w), h: klemm(r.h) };
  }
  const rad = typeof r.r === 'number' ? r.r : 0.07;
  return {
    label,
    x: klemm(r.x - rad), y: klemm(r.y - rad),
    w: klemm(rad * 2),   h: klemm(rad * 2),
  };
}
function klemm(n) { return Math.min(1, Math.max(0, typeof n === 'number' ? n : 0)); }

// Regionen auf die aktuellen Labels eindampfen: erbt eine Karte ihre ID, sollen
// die muehsam platzierten Regionen mitkommen – aber nur fuer Labels, die es noch gibt.
function uebernehmeRegionen(neu, alt) {
  if (neu.typ !== 'bild' || !alt || alt.typ !== 'bild') return;
  const quelle = Array.isArray(neu.regionen) && neu.regionen.length ? neu.regionen : alt.regionen;
  if (!Array.isArray(quelle) || !quelle.length) return;
  const labelSet = new Set(neu.labels.map(l => vortragNorm(l)));
  const gefiltert = quelle
    .filter(r => labelSet.has(vortragNorm(r?.label)))
    .map(r => regionSauber(r, neu.labels))
    .filter(Boolean);
  if (gefiltert.length) neu.regionen = gefiltert;
}

// Stabile IDs ueber Regenerationen hinweg – DAS Kernstueck fuer "Lernstand
// ueberlebt neue Karten": Der Review-Log referenziert nur Karten-IDs. Eine Karte
// mit derselben (normalisierten) Frage bekommt darum ihre alte ID zurueck; der
// Editor reicht bekannte IDs explizit durch (so behaelt auch eine Karte mit
// korrigiertem Tippfehler ihre Historie).
export function mergeKartenIds(neueKarten, alteKarten = [], opts = {}) {
  const idFn = typeof opts.idFn === 'function' ? opts.idFn : neueKartenId;
  const altById = new Map();
  const altByFrage = new Map();
  for (const a of Array.isArray(alteKarten) ? alteKarten : []) {
    if (!a || typeof a !== 'object') continue;
    if (a.id) altById.set(a.id, a);
    const nf = vortragNorm(a.frage);
    if (nf && !altByFrage.has(nf)) altByFrage.set(nf, a);
  }
  const verbraucht = new Set();
  const vergeben = new Set();
  let uebernommen = 0, neu = 0;

  const karten = neueKarten.map(k => {
    const out = saubereKarte(k);
    let alt = null;
    if (k.id && altById.has(k.id) && !verbraucht.has(k.id)) {
      alt = altById.get(k.id);
    } else {
      const nf = vortragNorm(out.frage);
      const kandidat = altByFrage.get(nf);
      if (kandidat && kandidat.id && !verbraucht.has(kandidat.id)) alt = kandidat;
    }
    if (alt && alt.id && !vergeben.has(alt.id)) {
      out.id = alt.id;
      verbraucht.add(alt.id);
      uebernommen++;
    } else {
      do { out.id = idFn(); } while (vergeben.has(out.id));
      neu++;
    }
    vergeben.add(out.id);
    // Regionen aus der Vorgaengerkarte retten (auch wenn die ID neu vergeben wurde,
    // aber eine inhaltsgleiche Bild-Karte existierte).
    uebernehmeRegionen(out, alt);
    // Vom Editor mitgelieferte Regionen gewinnen immer.
    if (out.typ === 'bild' && Array.isArray(k.regionen) && k.regionen.length) {
      const labelSet = new Set(out.labels.map(l => vortragNorm(l)));
      const gef = k.regionen
        .filter(r => labelSet.has(vortragNorm(r?.label)))
        .map(r => regionSauber(r, out.labels))
        .filter(Boolean);
      if (gef.length) out.regionen = gef;
    }
    // Feldreihenfolge stabil halten: id zuerst (bessere Diffs im Vault).
    const { id, ...rest } = out;
    return { id, ...rest };
  });

  return { karten, neu, uebernommen };
}

// ══════════════════════════════════════════════════════════════════════════════
// Datum (UTC-Mitternacht, ganze Tage – keine Zeitzonen-Fallen)
// ══════════════════════════════════════════════════════════════════════════════

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/;

export function istTag(s) { return typeof s === 'string' && ISO_TAG.test(s); }

// Der HEUTIGE Tag in der LOKALEN Zeitzone. Bewusst nicht toISOString(): fuer einen
// Nutzer in MESZ waere um 01:00 Uhr nachts noch der Vortag "heute" – Karten, die
// heute faellig sind, wuerden erst um 02:00 auftauchen. Reviews speichern denselben
// lokalen Tag als "tag", damit Faltung und Faelligkeit dieselbe Rechnung machen.
export function heuteISO(jetzt = new Date()) {
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function tagPlus(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function tageZwischen(vonIso, bisIso) {
  return Math.round((Date.parse(bisIso + 'T00:00:00Z') - Date.parse(vonIso + 'T00:00:00Z')) / 86400000);
}

// ══════════════════════════════════════════════════════════════════════════════
// Scheduler: SM-2-Lite (binaer richtig/falsch) mit Pruefungs-Kappung
//
// Warum nicht FSRS: FSRS braucht abgestufte Bewertungen (again/hard/good/easy) und
// Parameter-Optimierung ueber viele hundert Reviews. Hier bewertet der Nutzer nur
// richtig/falsch (bei Freitext sogar selbst) – SM-2-Lite ist damit die ehrlichere
// und in 30 Zeilen exakt testbare Wahl. LERN_VERFAHREN kennzeichnet das Verfahren,
// damit ein spaeterer Wechsel sichtbar wird.
// ══════════════════════════════════════════════════════════════════════════════

export const LERN_START = Object.freeze({
  stufe: 0, lapses: 0, intervall: 0,
  korrektGesamt: 0, antworten: 0, due: null, letztes: null, erstes: null,
});

/**
 * Stufen-Planer (Paul, 2026-08-09). Bewusst einfach und vorhersagbar statt SM-2:
 *
 *   Stufe 0 = neu · 1 = in 1 Tag · 2 = in 3 Tagen · 3 = in 5 · 4 = in 7 · 5 = fertig
 *
 * Aufsteigen darf eine Karte NUR, wenn sie in der Sitzung **auf Anhieb** sass
 * (`ctx.ersterVersuch`). Wer erst nach einem Fehlversuch richtig liegt, faellt auf
 * Stufe 1 zurueck und wird am Folgetag erneut gefragt. Das ist der Kern der Regel:
 * "richtig nach falsch" ist kein Fortschritt, sondern eine Korrektur.
 *
 * `ersterVersuch` kommt NICHT vom Client, sondern wird in foldReviews aus dem Log
 * abgeleitet (erste Antwort auf diese Karte in dieser Sitzung).
 */
export function lernPlanen(zustand, korrekt, heute, ctx = {}) {
  const z = { ...LERN_START, ...(zustand || {}) };
  z.antworten++;
  z.letztes = heute;
  if (!z.erstes) z.erstes = heute;
  const ersterVersuch = ctx.ersterVersuch !== false;

  if (!korrekt) {
    // Falsch: Karte bleibt HEUTE faellig – die Sitzung haengt sie hinten an, sie
    // kommt also noch in dieser Runde wieder. Die Stufe faellt sofort auf 0 zurueck,
    // damit ein Abbruch mitten in der Sitzung nicht als Fortschritt stehen bleibt.
    z.stufe = 0;
    z.lapses++;
    z.intervall = 0;
    z.due = heute;
    return z;
  }

  z.korrektGesamt++;
  // Auf Anhieb richtig -> eine Stufe hoch. Sonst zurueck auf die unterste Stufe.
  z.stufe = ersterVersuch ? Math.min(LERN_STUFEN.length + 1, (z.stufe || 0) + 1) : 1;

  if (z.stufe > LERN_STUFEN.length) {
    // Durch: keine weitere Wiederholung mehr eingeplant.
    z.intervall = 0;
    z.due = null;
    return z;
  }
  z.intervall = LERN_STUFEN[z.stufe - 1];

  // Pruefungs-Kappung: Bis zur Pruefung muessen die restlichen Stufen noch durchlaufen
  // werden. Damit sie alle VOR den Termin passen, wird das Intervall auf
  // Resttage/verbleibendeStufen gedeckelt – je weiter unten die Karte steht, desto
  // frueher kommt sie wieder. Nach der Pruefung greift die Kappung nicht mehr.
  const pruefung = istTag(ctx.pruefung) ? ctx.pruefung : null;
  if (pruefung) {
    const rest = tageZwischen(heute, pruefung);
    if (rest > 0) {
      const offen = Math.max(1, LERN_STUFEN.length - z.stufe + 1);
      z.intervall = Math.min(z.intervall, Math.max(1, Math.floor(rest / offen)));
    }
  }

  z.intervall = Math.min(MAX_INTERVALL, Math.max(1, z.intervall));
  z.due = tagPlus(heute, z.intervall);
  if (pruefung && z.due >= pruefung) {
    // Nie erst am Pruefungstag oder danach wieder abfragen – spaetestens am Vortag,
    // aber fruehestens morgen (sonst Endlosschleife am Pruefungstag selbst).
    const vortag = tagPlus(pruefung, -1);
    const morgen = tagPlus(heute, 1);
    z.due = vortag > morgen ? vortag : morgen;
    z.intervall = tageZwischen(heute, z.due);
  }
  return z;
}

// Ist die Karte durch (alle Stufen geschafft)?
export function istFertig(zustand) {
  return !!zustand && (zustand.stufe || 0) > LERN_STUFEN.length;
}

// Log -> Zustand je Karte. ctxFn(kartenId) liefert {pruefung, zielKorrekt}.
// Bewusste Vereinfachung: gefaltet wird mit dem HEUTIGEN Fach-Kontext, nicht mit
// dem historischen. Verschiebt der Nutzer den Pruefungstermin, plant das System
// also sofort komplett neu – genau das ist gewuenscht.
/**
 * Der Review-Log ist append-only – eine versehentlich falsch bewertete Antwort wird
 * nicht geloescht, sondern mit einer Storno-Zeile {karte, storniert:<t der Antwort>}
 * ungueltig gemacht. Liefert die Eintraege chronologisch und ohne stornierte Paare.
 */
export function ohneStornierte(eintraege) {
  const sortiert = [...(eintraege || [])].sort((a, b) => String(a?.t).localeCompare(String(b?.t)));
  const storniert = new Set();
  for (const e of sortiert) {
    if (e && typeof e.karte === 'string' && istText(e.storniert)) storniert.add(e.karte + '|' + e.storniert);
  }
  return sortiert.filter(e => e && !istText(e.storniert) && !storniert.has(e.karte + '|' + e.t));
}

export function foldReviews(eintraege, ctxFn) {
  const ctxFor = typeof ctxFn === 'function' ? ctxFn : () => ({});
  const zustaende = new Map();
  // Erster Versuch je (Sitzung, Karte): NUR dann darf eine Karte eine Stufe aufsteigen.
  // Bewusst hier aus dem Log abgeleitet und nicht vom Client uebernommen – sonst
  // koennte ein Reload oder ein manipulierter Aufruf Stufen erschleichen.
  // Antworten ohne Sitzungskennung (z.B. per API) gelten je Karte und Tag als Erstversuch.
  const gesehen = new Set();
  for (const e of ohneStornierte(eintraege)) {
    if (!e || typeof e.karte !== 'string' || !e.karte) continue;
    // "tag" ist der lokale Kalendertag der Antwort (siehe heuteISO); alte Zeilen ohne
    // das Feld fallen auf den UTC-Tag des Zeitstempels zurueck.
    const tag = istTag(e.tag) ? e.tag : (typeof e.t === 'string' ? e.t.slice(0, 10) : '');
    if (!istTag(tag)) continue;
    const runde = (e.session ? 's:' + e.session : 'd:' + tag) + '|' + e.karte;
    const ersterVersuch = !gesehen.has(runde);
    gesehen.add(runde);
    const vorher = zustaende.get(e.karte) || null;
    zustaende.set(e.karte, lernPlanen(vorher, e.korrekt === true, tag, { ...ctxFor(e.karte), ersterVersuch }));
  }
  return zustaende;
}

export function istFaellig(zustand, heute) {
  if (istFertig(zustand)) return false;           // durch: keine Wiederholung mehr
  if (!zustand || !zustand.due) return true;      // nie beantwortet = neu = faellig
  return zustand.due <= heute;
}

// ══════════════════════════════════════════════════════════════════════════════
// Faecher
// ══════════════════════════════════════════════════════════════════════════════

function normOrdner(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

// Erstes Fach, dessen Ordner-Praefix passt. Laengster Praefix gewinnt, damit ein
// Unterordner ("Uni/NHM/Uebungen") ein eigenes Fach sein kann, obwohl der
// Elternordner schon einem anderen zugeordnet ist.
export function fachFuerNotiz(notizPfad, faecher = []) {
  const p = normOrdner(notizPfad);
  let treffer = null, best = -1;
  for (const f of faecher) {
    for (const o of (Array.isArray(f?.ordner) ? f.ordner : [])) {
      const ord = normOrdner(o);
      if (!ord) continue;
      if (p === ord || p.startsWith(ord + '/')) {
        if (ord.length > best) { best = ord.length; treffer = f; }
      }
    }
  }
  return treffer;
}

export function validateFaecher(faecher) {
  const errors = [];
  if (!Array.isArray(faecher)) { errors.push('faecher muss eine Liste sein'); return errors; }
  const ids = new Set();
  faecher.forEach((f, i) => {
    const nr = `Fach ${i + 1}`;
    if (!f || typeof f !== 'object') { errors.push(`${nr}: kein Objekt`); return; }
    if (!istText(f.name)) { errors.push(`${nr}: "name" fehlt`); return; }
    if (!istText(f.id))   { errors.push(`${nr} (${f.name}): "id" fehlt`); return; }
    if (ids.has(f.id))    { errors.push(`${nr} (${f.name}): id "${f.id}" ist doppelt`); return; }
    ids.add(f.id);
    if (!Array.isArray(f.ordner) || f.ordner.length === 0 || !f.ordner.every(istText)) {
      errors.push(`${nr} (${f.name}): mindestens ein Ordner noetig`);
      return;
    }
    if (f.pruefung !== undefined && f.pruefung !== null && f.pruefung !== '' && !istTag(f.pruefung)) {
      errors.push(`${nr} (${f.name}): "pruefung" muss JJJJ-MM-TT sein (erhalten: ${f.pruefung})`);
    }
    if (f.zielKorrekt !== undefined && f.zielKorrekt !== null &&
        (!Number.isInteger(f.zielKorrekt) || f.zielKorrekt < 1 || f.zielKorrekt > 20)) {
      errors.push(`${nr} (${f.name}): "zielKorrekt" muss 1-20 sein`);
    }
    if (f.neueProTag !== undefined && f.neueProTag !== null &&
        (!Number.isInteger(f.neueProTag) || f.neueProTag < 0 || f.neueProTag > 500)) {
      errors.push(`${nr} (${f.name}): "neueProTag" muss 0-500 sein`);
    }
  });
  return errors;
}

export function fachKontext(fach, standard = LERN_STANDARD) {
  return {
    pruefung: istTag(fach?.pruefung) ? fach.pruefung : null,
    zielKorrekt: Number.isInteger(fach?.zielKorrekt) ? fach.zielKorrekt : standard.zielKorrekt,
    neueProTag: Number.isInteger(fach?.neueProTag) ? fach.neueProTag : standard.neueProTag,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Uebersicht + Sitzungs-Queue (pure – ui-server reicht nur Dateien herein)
// ══════════════════════════════════════════════════════════════════════════════

function leerStat(extra = {}) {
  return {
    karten: 0, faellig: 0, neu: 0, bildOffen: 0,
    angefangen: 0, fertig: 0, richtig: 0, antworten: 0,
    stufen: Array.from({ length: LERN_STUFEN.length + 2 }, () => 0),
    ...extra,
  };
}

function zaehle(stat, k, z, ziel, heute) {
  stat.karten++;
  const spielbar = karteSpielbar(k);
  if (!spielbar) { stat.bildOffen++; return; }
  const fertig = istFertig(z);
  // Reihenfolge wichtig: eine durchgelernte Karte hat ebenfalls due=null, waere ohne
  // diese Abfrage also faelschlich "neu" und damit jeden Tag wieder faellig.
  if (fertig) stat.fertig++;
  else if (!z || !z.due) stat.neu++;
  else if (z.due <= heute) stat.faellig++;
  if (z) {
    stat.antworten += z.antworten || 0;
    stat.richtig   += z.korrektGesamt || 0;
    if ((z.antworten || 0) > 0 && !fertig) stat.angefangen++;
    // Stufenverteilung: 0 = neu/zurueckgefallen, 1..n = Leiter, n+1 = durch
    const stufe = fertig ? LERN_STUFEN.length + 1 : ((z && z.stufe) || 0);
    stat.stufen[stufe] = (stat.stufen[stufe] || 0) + 1;
  } else {
    stat.stufen[0] = (stat.stufen[0] || 0) + 1;
  }
}

/**
 * Baut den Dashboard-Payload: was ist heute faellig (notizweise!), wie steht es je
 * Fach, und schafft der Nutzer sein Pensum bis zur Pruefung.
 *
 * sidecars: [{ notiz, titel?, karten: [...] }]  (notiz = Pfad der .md aus dem Dateinamen)
 * zustaende: Map(kartenId -> Zustand) aus foldReviews
 */
export function lernUebersicht({ sidecars = [], zustaende = new Map(), faecher = [], heute, standard = LERN_STANDARD }) {
  const proFach = new Map();
  const notizen = [];
  const gesamt = leerStat();

  for (const f of faecher) {
    const ctx = fachKontext(f, standard);
    proFach.set(f.id, {
      id: f.id, name: f.name, farbe: f.farbe || null,
      pruefung: ctx.pruefung,
      resttage: ctx.pruefung ? tageZwischen(heute, ctx.pruefung) : null,
      zielKorrekt: ctx.zielKorrekt, neueProTag: ctx.neueProTag,
      notizen: 0, ...leerStat(), fehlend: 0,
    });
  }
  const ohneFach = { id: null, name: 'Ohne Fach', farbe: null, pruefung: null, resttage: null,
    zielKorrekt: standard.zielKorrekt, neueProTag: standard.neueProTag, notizen: 0, ...leerStat(), fehlend: 0 };

  for (const sc of sidecars) {
    const fach = fachFuerNotiz(sc.notiz, faecher);
    const eintrag = fach ? proFach.get(fach.id) : ohneFach;
    const ziel = eintrag.zielKorrekt;
    const nStat = leerStat();
    let letztes = null;
    for (const k of sc.karten || []) {
      const z = zustaende.get(k.id) || null;
      zaehle(nStat, k, z, ziel, heute);
      zaehle(eintrag, k, z, ziel, heute);
      zaehle(gesamt, k, z, ziel, heute);
      // Restaufwand bis "durch": wie viele Stufen fehlen dieser Karte noch?
      if (karteSpielbar(k)) eintrag.fehlend += istFertig(z) ? 0 : (LERN_STUFEN.length - ((z && z.stufe) || 0));
      if (z?.letztes && (!letztes || z.letztes > letztes)) letztes = z.letztes;
    }
    eintrag.notizen++;
    const themen = themenJeNotiz(sc, { zustaende, heute });
    notizen.push({
      notiz: sc.notiz,
      titel: sc.titel || sc.notiz.split('/').pop().replace(/\.md$/i, ''),
      // Nur mitschicken, wenn es echte Themen gibt – eine einzige Gruppe "ohne Thema"
      // ist keine Gliederung und wuerde die Auswahl nur aufblaehen.
      ...(themen.length > 1 || (themen.length === 1 && themen[0].thema) ? { themen } : {}),
      fach: fach ? fach.id : null,
      fachName: fach ? fach.name : null,
      fachFarbe: fach ? (fach.farbe || null) : null,
      letztes,
      ...nStat,
    });
  }

  const fertigFach = (e) => {
    // Pensum-Prognose: wie viele richtige Antworten muessen pro Resttag noch kommen,
    // damit jede Karte zielKorrekt-mal gesessen hat.
    if (e.pruefung && e.resttage !== null && e.resttage > 0) {
      e.proTagNoetig = Math.ceil(e.fehlend / e.resttage);
      e.aufKurs = e.proTagNoetig <= Math.max(e.neueProTag, 10);
    } else {
      e.proTagNoetig = null;
      e.aufKurs = null;
    }
    e.quote = e.antworten > 0 ? Math.round((e.richtig / e.antworten) * 100) : null;
    return e;
  };

  const faecherOut = [...proFach.values()].map(fertigFach);
  if (ohneFach.karten > 0) faecherOut.push(fertigFach(ohneFach));

  notizen.sort((a, b) => (b.faellig + b.neu) - (a.faellig + a.neu) || a.notiz.localeCompare(b.notiz));

  return {
    heute,
    verfahren: LERN_VERFAHREN,
    stufenTage: [...LERN_STUFEN],
    gesamt: { ...gesamt, quote: gesamt.antworten > 0 ? Math.round((gesamt.richtig / gesamt.antworten) * 100) : null },
    faecher: faecherOut,
    notizen,
    faellige: notizen.filter(n => n.faellig + n.neu > 0),
    kalender: kalenderVorschau({ sidecars, zustaende, faecher, heute, tage: 5 }),
  };
}

/**
 * Was steht in den naechsten Tagen an? Zaehlt je Kalendertag die Karten, deren
 * Wiederholung auf diesen Tag faellt. Der heutige Eintrag nimmt alles Ueberfaellige
 * mit auf (das muss ja heute weg) und dazu die noch nie gefragten Karten.
 */
export function kalenderVorschau({ sidecars = [], zustaende = new Map(), faecher = [], heute, tage = 5, fach }) {
  const reihe = [];
  for (let i = 0; i < Math.max(1, tage); i++) {
    const tag = tagPlus(heute, i);
    reihe.push({ tag, faellig: 0, neu: 0, ueberfaellig: 0 });
  }
  const index = new Map(reihe.map((e, i) => [e.tag, i]));
  for (const sc of sidecars) {
    const f = fachFuerNotiz(sc.notiz, faecher);
    const fachId = f ? f.id : null;
    if (fach !== undefined && fachId !== fach) continue;
    for (const k of sc.karten || []) {
      if (!karteSpielbar(k)) continue;
      const z = zustaende.get(k.id) || null;
      if (istFertig(z)) continue;
      if (!z || !z.due) { reihe[0].neu++; continue; }
      if (z.due < heute) { reihe[0].ueberfaellig++; continue; }
      const i = index.get(z.due);
      if (i !== undefined) reihe[i].faellig++;
    }
  }
  return reihe;
}

/**
 * Themen-Auswahl aufbereiten. Eintraege sind "<Notiz>::<Thema>"; ein leerer Themen-Teil
 * meint die Karten dieser Notiz, die kein Thema tragen. Rueckgabe kennt zwei Fragen:
 * ist diese Notiz ueberhaupt dabei (spart das Durchlaufen) und passt diese Karte.
 */
export function themenFilter(liste) {
  if (!Array.isArray(liste) || !liste.length) return null;
  const paare = new Set();
  const notizen = new Set();
  for (const eintrag of liste) {
    if (typeof eintrag !== 'string' || !eintrag) continue;
    const i = eintrag.indexOf('::');
    const notiz = i < 0 ? eintrag : eintrag.slice(0, i);
    const thema = i < 0 ? '' : eintrag.slice(i + 2);
    notizen.add(notiz);
    paare.add(notiz + '::' + vortragNorm(thema));
  }
  if (!paare.size) return null;
  return {
    hatNotiz: (notiz) => notizen.has(notiz),
    passt: (notiz, thema) => paare.has(notiz + '::' + vortragNorm(thema || '')),
  };
}

/**
 * Themen nachtragen, ohne die Karten anzufassen.
 *
 * Die Idee: Jede Karte traegt ihr Belegzitat (`quelle`), und das steht per Validierung
 * WOERTLICH in der Notiz. Wo das Zitat steht, laesst sich also bestimmen – und die
 * naechste Ueberschrift darueber ist der Abschnitt, aus dem die Karte stammt. Damit
 * entsteht die Gliederung aus dem Skript selbst, ohne Raterei.
 *
 * Gesucht wird im normalisierten Text (gleiche Normalisierung wie die Validierung),
 * darum wird Zeile fuer Zeile normalisiert und die Startposition jeder Zeile im
 * Suchtext mitgefuehrt – so laesst sich ein Treffer auf seine Zeile zurueckrechnen.
 *
 * @param ebene  bis zu welcher Ueberschriften-Tiefe gruppiert wird (1 = nur "#",
 *               2 = "#" und "##", …). Tiefere Ueberschriften zaehlen zum letzten
 *               Abschnitt dieser Tiefe.
 * @returns {{karten: Array, zugeordnet:number, offen:number, themen:string[]}}
 */
export function themenAusGliederung(noteContent, karten, { ebene = 2 } = {}) {
  const rumpf = ohneFrontmatter(String(noteContent || ''));
  const zeilen = rumpf.split(/\r?\n/);

  // Ueberschriften einsammeln und parallel den normalisierten Suchtext aufbauen.
  const kopf = [];                 // { pos, titel }  pos = Index im Suchtext
  const teile = [];
  let pos = 0;
  let aktuell = null;
  for (const zeile of zeilen) {
    const m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(zeile);
    if (m && m[1].length <= ebene) {
      const titel = vortragNorm(m[2]).trim();
      // Roh-Titel (nur Markdown-Dekoration entfernt) – das ist der lesbare Name.
      aktuell = m[2].replace(/[*_~`]/g, '').trim();
      if (aktuell) kopf.push({ pos, titel, name: aktuell });
    }
    const norm = vortragNorm(zeile);
    if (norm) {
      teile.push({ start: pos, text: norm });
      pos += norm.length + 1;      // +1 fuer das trennende Leerzeichen
    }
  }
  const suchtext = teile.map(t => t.text).join(' ');

  // Letzte Ueberschrift, die vor dieser Fundstelle beginnt.
  const abschnittFuer = (index) => {
    let treffer = null;
    for (const k of kopf) { if (k.pos <= index) treffer = k; else break; }
    return treffer ? treffer.name : '';
  };

  const themen = new Set();
  let zugeordnet = 0, offen = 0;
  const out = (karten || []).map(k => {
    const kopie = { ...k };
    const quelle = istText(k.quelle) ? vortragNorm(k.quelle) : '';
    if (!quelle) { offen++; return kopie; }        // z. B. Bild-Karten ohne Zitat
    const i = suchtext.indexOf(quelle);
    if (i < 0) { offen++; return kopie; }          // Notiz seit dem Schreiben geaendert
    const thema = abschnittFuer(i);
    if (!thema) { offen++; return kopie; }
    kopie.thema = thema;
    themen.add(thema);
    zugeordnet++;
    return kopie;
  });

  return { karten: out, zugeordnet, offen, themen: [...themen] };
}

/**
 * Themen einer Notiz mit Kartenzahl – Grundlage der aufklappbaren Auswahl.
 * Karten ohne Thema landen unter dem Schluessel '' ("Ohne Thema").
 *
 * Mit `zustaende`+`heute` kommen zusaetzlich die Zahlen dazu, nach denen der Nutzer
 * in der Auswahl entscheidet: was ist heute faellig, was ist noch nie gefragt worden,
 * was sitzt schon. Ohne diese Angaben bleibt es bei der reinen Kartenzahl (so rufen
 * es aeltere Aufrufer auf).
 */
export function themenJeNotiz(sidecar, { zustaende = null, heute = null } = {}) {
  const map = new Map();
  for (const k of (sidecar && sidecar.karten) || []) {
    const t = istText(k.thema) ? k.thema.trim() : '';
    const e = map.get(t) || { thema: t, karten: 0, spielbar: 0, faellig: 0, neu: 0, gelernt: 0 };
    e.karten++;
    if (karteSpielbar(k)) {
      e.spielbar++;
      if (zustaende) {
        const z = zustaende.get(k.id) || null;
        // Gleiche Reihenfolge wie in zaehle(): "gelernt" hat ebenfalls kein due.
        if (istFertig(z)) e.gelernt++;
        else if (!z || !z.due) e.neu++;
        else if (heute && z.due <= heute) e.faellig++;
      }
    }
    map.set(t, e);
  }
  // Themen alphabetisch, "Ohne Thema" ans Ende
  return [...map.values()].sort((a, b) =>
    (a.thema === '') - (b.thema === '') || a.thema.localeCompare(b.thema, 'de'));
}

/**
 * Sitzungs-Queue. filter: { notiz } | { notizen: [...] } | { themen: [...] } | { fach } | {} (= alles
 * Faellige im Vault). Reihenfolge: am laengsten ueberfaellig zuerst, dann neue Karten –
 * gedeckelt auf neueProTag je Fach ABZUEGLICH der heute bereits neu eingefuehrten
 * Karten (sonst schwemmt ein frisch generiertes Kartenset die Sitzung zu).
 *
 * `uebung: true` (Modus "einfach so abfragen"): nimmt ALLE spielbaren Karten des
 * Ausschnitts, unabhaengig von Faelligkeit, Stufe und Tagesbudget – und gemischt,
 * weil es hier ums Wiederholen geht, nicht ums Nachholen. Der Aufrufer schreibt in
 * diesem Modus keine Antworten weg, der Lernstand bleibt also unberuehrt.
 *
 * `ohneTageslimit: true`: das Tagesbudget `neueProTag` wird ignoriert. Gedacht fuer den
 * Fall "heute ist genau DIESE Vorlesung dran" – wer ein Thema bewusst auswaehlt, will
 * es ganz lernen und nicht nach 20 Karten ausgebremst werden. Der Wiederholungsplan
 * bleibt davon unberuehrt, es kommt nur mehr auf einmal dran.
 *
 * `limit <= 0`: keine Obergrenze (der Aufrufer deckelt selbst, siehe ui-server).
 */
export function sessionQueue({ sidecars = [], zustaende = new Map(), faecher = [], heute, standard = LERN_STANDARD, filter = {}, limit = 60, uebung = false, ohneTageslimit = false }) {
  const faellig = [], neu = [], alle = [];
  let uebersprungenBild = 0;
  const neuHeute = new Map(); // fachId -> Anzahl heute bereits neu eingefuehrter Karten
  const nurNotizen = Array.isArray(filter.notizen) && filter.notizen.length
    ? new Set(filter.notizen) : null;
  const nurThemen = themenFilter(filter.themen);

  for (const sc of sidecars) {
    if (filter.notiz && sc.notiz !== filter.notiz) continue;
    if (nurNotizen && !nurNotizen.has(sc.notiz)) continue;
    // Themen-Auswahl: Eintraege der Form "<Notiz>::<Thema>"; "<Notiz>::" meint die
    // Karten dieser Notiz ohne Thema. So bleibt eine Auswahl ueber mehrere Lernsets
    // hinweg in einer flachen Liste beschreibbar.
    if (nurThemen && !nurThemen.hatNotiz(sc.notiz)) continue;
    const fach = fachFuerNotiz(sc.notiz, faecher);
    const fachId = fach ? fach.id : null;
    // 'fach' in filter statt Wahrheitswert: so ist filter.fach===null ein gueltiger
    // Filter ("Karten ohne Fach") und nicht versehentlich "kein Filter".
    if ('fach' in filter && fachId !== filter.fach) continue;
    const ctx = fachKontext(fach, standard);
    for (const k of sc.karten || []) {
      const z = zustaende.get(k.id) || null;
      if (z && z.erstes === heute) neuHeute.set(fachId, (neuHeute.get(fachId) || 0) + 1);
      if (nurThemen && !nurThemen.passt(sc.notiz, k.thema)) continue;
      if (!karteSpielbar(k)) { uebersprungenBild++; continue; }
      const eintrag = { karte: k, notiz: sc.notiz, titel: sc.titel || null, fach: fachId, zustand: z, ctx };
      if (uebung) { alle.push(eintrag); continue; }
      if (istFertig(z)) continue;                    // durch: nicht mehr einplanen
      if (!z || !z.due) neu.push(eintrag);
      else if (z.due <= heute) faellig.push(eintrag);
    }
  }

  if (uebung) {
    // Stabil durchmischen (kein Math.random: gleiche Eingabe -> gleiche Reihenfolge,
    // damit der Ablauf testbar bleibt). Streut Notizen ineinander statt Block fuer Block.
    const gemischt = alle
      .map((e, i) => ({ e, s: ((i * 2654435761) % 4294967296) ^ (e.karte.id ? e.karte.id.charCodeAt(1) * 7919 : 0) }))
      .sort((a, b) => a.s - b.s)
      .map(x => x.e);
    const q = limit > 0 ? gemischt.slice(0, limit) : gemischt;
    return {
      heute, uebung: true, karten: q, gesamt: alle.length,
      faellig: 0, neu: 0, uebersprungenBild,
    };
  }

  faellig.sort((a, b) => String(a.zustand.due).localeCompare(String(b.zustand.due)) ||
                         (b.zustand.lapses || 0) - (a.zustand.lapses || 0));

  const budget = new Map();
  const neuGefiltert = ohneTageslimit ? neu : neu.filter(e => {
    const max = e.ctx.neueProTag;
    if (!Number.isFinite(max)) return true;
    const schon = budget.get(e.fach) ?? (neuHeute.get(e.fach) || 0);
    if (schon >= max) return false;
    budget.set(e.fach, schon + 1);
    return true;
  });

  const zusammen = [...faellig, ...neuGefiltert];
  const queue = limit > 0 ? zusammen.slice(0, limit) : zusammen;
  return {
    heute,
    karten: queue,
    gesamt: faellig.length + neuGefiltert.length,
    faellig: faellig.length,
    neu: neuGefiltert.length,
    neuZurueckgehalten: neu.length - neuGefiltert.length,
    uebersprungenBild,
  };
}

/**
 * Statistik: was wurde wann gelernt, wie gut sitzt es, was macht Probleme.
 * Pure Funktion – bekommt den rohen Review-Log herein und rechnet ohne FS/Datum-Zugriff.
 * `fach` = Fach-ID | null ("Ohne Fach") | undefined (alles).
 */
export function lernStatistik({ sidecars = [], zustaende = new Map(), reviews = [], faecher = [], heute, tage = 30, fach, standard = LERN_STANDARD }) {
  // Karten-ID -> {notiz, karte, fachId} nur fuer den gewaehlten Ausschnitt
  const karten = new Map();
  for (const sc of sidecars) {
    const f = fachFuerNotiz(sc.notiz, faecher);
    const fachId = f ? f.id : null;
    if (fach !== undefined && fachId !== fach) continue;
    const ziel = fachKontext(f, standard).zielKorrekt;
    for (const k of sc.karten || []) karten.set(k.id, { notiz: sc.notiz, titel: sc.titel, karte: k, fachId, ziel });
  }

  // Tagesverlauf: erst ab dem ersten Tag im Fenster, damit die Reihe nicht ins Leere laeuft.
  const von = tagPlus(heute, -(Math.max(1, tage) - 1));
  const proTag = new Map();
  for (let t = von; t <= heute; t = tagPlus(t, 1)) proTag.set(t, { tag: t, gesamt: 0, richtig: 0 });
  let gesamtAntworten = 0, gesamtRichtig = 0, ersteAntwort = null, letzteAntwort = null;
  for (const e of ohneStornierte(reviews)) {
    if (!karten.has(e.karte)) continue;
    const tag = istTag(e.tag) ? e.tag : String(e.t || '').slice(0, 10);
    if (!istTag(tag)) continue;
    gesamtAntworten++;
    if (e.korrekt === true) gesamtRichtig++;
    if (!ersteAntwort || tag < ersteAntwort) ersteAntwort = tag;
    if (!letzteAntwort || tag > letzteAntwort) letzteAntwort = tag;
    const eintrag = proTag.get(tag);
    if (eintrag) { eintrag.gesamt++; if (e.korrekt === true) eintrag.richtig++; }
  }

  // Verteilung + Problemkarten
  let neu = 0, amLernen = 0, sitzt = 0, bildOffen = 0;
  const stufen = Array.from({ length: LERN_STUFEN.length + 2 }, () => 0);
  const problem = [];
  for (const [id, info] of karten) {
    if (!karteSpielbar(info.karte)) { bildOffen++; continue; }
    const z = zustaende.get(id);
    const fertig = istFertig(z);
    stufen[fertig ? LERN_STUFEN.length + 1 : ((z && z.stufe) || 0)]++;
    if (fertig) sitzt++;
    else if (!z || !z.antworten) neu++;
    else amLernen++;
    if (z && (z.lapses || 0) > 0) {
      problem.push({
        id, frage: info.karte.frage, typ: info.karte.typ, notiz: info.notiz,
        lapses: z.lapses, antworten: z.antworten || 0, korrekt: z.korrektGesamt || 0,
        quote: z.antworten ? Math.round(((z.korrektGesamt || 0) / z.antworten) * 100) : null,
        due: z.due || null,
      });
    }
  }
  problem.sort((a, b) => b.lapses - a.lapses || (a.quote ?? 100) - (b.quote ?? 100));

  // Serie: aufeinanderfolgende Tage mit mindestens einer Antwort, bis heute (bzw. gestern).
  let serie = 0;
  for (let t = heute; ; t = tagPlus(t, -1)) {
    const e = proTag.get(t);
    if (!e) break;
    if (e.gesamt > 0) serie++;
    else if (t !== heute) break;          // heute noch nichts gelernt bricht die Serie nicht
    else if (serie > 0) break;
  }

  const verlauf = [...proTag.values()];
  const aktiveTage = verlauf.filter(v => v.gesamt > 0).length;
  return {
    heute, tage, fach: fach === undefined ? 'alle' : fach,
    karten: karten.size,
    verteilung: { neu, amLernen, sitzt, bildOffen },
    stufen, stufenTage: [...LERN_STUFEN],
    gesamt: {
      antworten: gesamtAntworten, richtig: gesamtRichtig,
      quote: gesamtAntworten ? Math.round((gesamtRichtig / gesamtAntworten) * 100) : null,
      ersteAntwort, letzteAntwort, aktiveTage, serie,
      schnitt: aktiveTage ? Math.round(gesamtAntworten / aktiveTage) : 0,
    },
    verlauf,
    problemKarten: problem.slice(0, 12),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Datei-IO (Vault) – wird von tools.js (MCP) und ui-server.js genutzt
// ══════════════════════════════════════════════════════════════════════════════

function safeJoin(vaultPath, rel) {
  const root = resolve(vaultPath);
  const full = resolve(vaultPath, rel || '');
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

// Atomar schreiben + VOLLER Read-Back (R14+-Muster aus tools.js): ueber den
// Windows<->Linux-Mount koennen Schreibvorgaenge laengengleich korrumpieren.
function schreibeAtomar(full, content) {
  mkdirSync(dirname(full), { recursive: true });
  const tmp = full + '.nexustmp';
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, full);
  const back = readFileSync(full, 'utf8');
  if (back !== content) throw new Error('Schreib-Integritaet verletzt: Read-Back weicht ab (' + full + ')');
}

/**
 * Alle *.karten.json des Vaults einlesen. cache: optionale Map(datei -> {mtime, sidecar}),
 * damit das Dashboard nicht bei jedem Poll alles neu parst.
 */
export function scanKartenSidecars(vaultPath, cache) {
  const out = [];
  const gesehen = new Set();
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(join(dir, e.name), rel ? rel + '/' + e.name : e.name);
      } else if (e.isFile() && /\.karten\.json$/i.test(e.name)) {
        const relPfad = rel ? rel + '/' + e.name : e.name;
        const full = join(dir, e.name);
        gesehen.add(relPfad);
        let mtime = 0;
        try { mtime = statSync(full).mtimeMs; } catch { continue; }
        const hit = cache?.get(relPfad);
        if (hit && hit.mtime === mtime) { out.push(hit.sidecar); continue; }
        let json;
        try { json = JSON.parse(readFileSync(full, 'utf8')); } catch { continue; }
        if (!json || json.version !== KARTEN_VERSION || !Array.isArray(json.karten)) continue;
        const sidecar = {
          notiz: notizAusSidecarPath(relPfad),   // aus dem Dateinamen, nicht aus dem JSON-Feld
          datei: relPfad,
          titel: typeof json.titel === 'string' ? json.titel : null,
          notizHash: json.notizHash || null,
          erstellt: json.erstellt || null,
          karten: json.karten.filter(k => k && typeof k.id === 'string'),
        };
        cache?.set(relPfad, { mtime, sidecar });
        out.push(sidecar);
      }
    }
  };
  walk(resolve(vaultPath), '');
  if (cache) for (const key of [...cache.keys()]) if (!gesehen.has(key)) cache.delete(key);
  out.sort((a, b) => a.notiz.localeCompare(b.notiz));
  return out;
}

export function readKartenSidecar(vaultPath, notizPfad) {
  const rel = kartenSidecarPath(notizPfad);
  const full = safeJoin(vaultPath, rel);
  if (!full || !existsSync(full)) return null;
  try {
    const json = JSON.parse(readFileSync(full, 'utf8'));
    if (!json || json.version !== KARTEN_VERSION || !Array.isArray(json.karten)) return null;
    return json;
  } catch { return null; }
}

export function logDateiFuer(tagIso) {
  return LERN_LOGDIR + '/' + tagIso.slice(0, 7) + '.jsonl';
}

export function appendReview(vaultPath, eintrag) {
  if (!eintrag || typeof eintrag.karte !== 'string' || !eintrag.karte) return { error: 'karte (ID) fehlt' };
  if (typeof eintrag.korrekt !== 'boolean') return { error: 'korrekt muss true/false sein' };
  const t = typeof eintrag.t === 'string' && eintrag.t.length >= 10 ? eintrag.t : new Date().toISOString();
  if (!istTag(t.slice(0, 10))) return { error: 'ungueltiger Zeitstempel: ' + t };
  const tag = istTag(eintrag.tag) ? eintrag.tag : heuteISO(new Date(t));
  const zeile = JSON.stringify({
    t,
    tag,
    karte: eintrag.karte,
    korrekt: eintrag.korrekt,
    ...(eintrag.notiz ? { notiz: String(eintrag.notiz).replace(/\\/g, '/') } : {}),
    ...(Number.isFinite(eintrag.dauerMs) ? { dauerMs: Math.round(eintrag.dauerMs) } : {}),
    ...(eintrag.session ? { session: String(eintrag.session) } : {}),
    ...(eintrag.detail && typeof eintrag.detail === 'object' ? { detail: eintrag.detail } : {}),
  }) + '\n';
  const full = safeJoin(vaultPath, logDateiFuer(t.slice(0, 10)));
  if (!full) return { error: 'Pfad ausserhalb des Vaults' };
  try {
    mkdirSync(dirname(full), { recursive: true });
    appendFileSync(full, zeile, 'utf8');   // append: kein Read-Modify-Write -> keine Mount-Trunkierung
  } catch (e) { return { error: e.message }; }
  return { ok: true, t };
}

/**
 * Eine bereits geschriebene Antwort ungueltig machen (fuer "war doch falsch geklickt").
 * Loescht nichts – haengt eine Storno-Zeile an, die foldReviews/lernStatistik beachten.
 */
export function storniereReview(vaultPath, { karte, t }) {
  if (typeof karte !== 'string' || !karte) return { error: 'karte (ID) fehlt' };
  if (typeof t !== 'string' || !istTag(t.slice(0, 10))) return { error: 'ungueltiger Zeitstempel: ' + t };
  const jetzt = new Date().toISOString();
  const zeile = JSON.stringify({ t: jetzt, tag: heuteISO(), karte, storniert: t }) + '\n';
  // Bewusst in die Log-Datei des STORNO-Zeitpunkts: readReviews liest ohnehin alle.
  const full = safeJoin(vaultPath, logDateiFuer(jetzt.slice(0, 10)));
  if (!full) return { error: 'Pfad ausserhalb des Vaults' };
  try {
    mkdirSync(dirname(full), { recursive: true });
    appendFileSync(full, zeile, 'utf8');
  } catch (e) { return { error: e.message }; }
  return { ok: true, storniert: t };
}

/**
 * Karten als Anki-Deck exportieren (TSV, wie Ankis "Notizen im Textformat" erwartet).
 * Bild- und Mehrfachwahl-Karten werden dabei zwangslaeufig flach: Anki kennt weder
 * Bildregionen noch Selbstbewertung, darum wird die Loesung schlicht in die Rueckseite
 * geschrieben. Der Lernstand bleibt in Nexus – Anki startet bei null.
 */
export function ankiExport({ sidecars = [], faecher = [], fach } = {}) {
  const zeilen = [];
  let bilder = 0;
  const escFeld = (s) => String(s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');
  for (const sc of sidecars) {
    const f = fachFuerNotiz(sc.notiz, faecher);
    const fachId = f ? f.id : null;
    if (fach !== undefined && fachId !== fach) continue;
    const deck = f ? f.name : 'Ohne Fach';
    for (const k of sc.karten || []) {
      let vorne = k.frage, hinten = '';
      if (k.typ === 'janein') hinten = k.antwort ? 'Stimmt' : 'Stimmt nicht';
      else if (k.typ === 'freitext') hinten = k.antwort || '';
      else if (k.typ === 'mc') {
        vorne = k.frage + '<br><br>' + (k.optionen || []).map((o, i) => `${i + 1}. ${o}`).join('<br>');
        hinten = (k.korrekt || []).map(i => (k.optionen || [])[i]).filter(Boolean).join(', ');
      } else if (k.typ === 'bild') {
        bilder++;
        vorne = k.frage + '<br>[' + (k.bild || '') + ']';
        hinten = (k.labels || []).join(', ');
      }
      if (k.erklaerung) hinten += (hinten ? '<br><br>' : '') + k.erklaerung;
      zeilen.push([escFeld(vorne), escFeld(hinten), escFeld(deck), escFeld(sc.notiz)].join('\t'));
    }
  }
  const kopf = ['#separator:tab', '#html:true', '#columns:Vorderseite\tRueckseite\tDeck\tNotiz'];
  return {
    tsv: kopf.concat(zeilen).join('\n') + '\n',
    karten: zeilen.length,
    bildKarten: bilder,
    hinweis: bilder
      ? 'Bild-Karten wurden flach exportiert (Anki kennt keine Bildregionen): Frage + Bildpfad vorne, alle Begriffe hinten.'
      : undefined,
  };
}

/**
 * Kompletten Review-Log lesen. Liest bewusst ALLE *.jsonl im Log-Ordner, also auch
 * Syncthing-Konfliktkopien ("2026-08.sync-conflict-….jsonl") – deren Zeilen sind
 * echte Antworten, die sonst verloren gingen. Deduplikation ueber (t|karte).
 */
export function readReviews(vaultPath) {
  const dir = safeJoin(vaultPath, LERN_LOGDIR);
  if (!dir || !existsSync(dir)) return [];
  let dateien;
  try { dateien = readdirSync(dir).filter(f => /\.jsonl$/i.test(f)).sort(); } catch { return []; }
  const seen = new Set();
  const out = [];
  for (const f of dateien) {
    let text;
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const zeile of text.split('\n')) {
      const s = zeile.trim();
      if (!s) continue;
      let e;
      try { e = JSON.parse(s); } catch { continue; }   // halbe Zeile durch Sync-Abbruch: ueberspringen
      if (!e || typeof e.karte !== 'string' || typeof e.t !== 'string') continue;
      const key = e.t + '|' + e.karte;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
  }
  out.sort((a, b) => a.t.localeCompare(b.t));
  return out;
}

export function readFaecher(vaultPath) {
  const full = safeJoin(vaultPath, FAECHER_REL);
  if (!full || !existsSync(full)) return [];
  try {
    const json = JSON.parse(readFileSync(full, 'utf8'));
    return Array.isArray(json?.faecher) ? json.faecher : [];
  } catch { return []; }
}

export function writeFaecher(vaultPath, faecher) {
  const errors = validateFaecher(faecher);
  if (errors.length) return { error: 'Faecher ungueltig:\n- ' + errors.join('\n- ') };
  const full = safeJoin(vaultPath, FAECHER_REL);
  if (!full) return { error: 'Pfad ausserhalb des Vaults' };
  const content = JSON.stringify({ version: KARTEN_VERSION, faecher }, null, 2) + '\n';
  try { schreibeAtomar(full, content); } catch (e) { return { error: e.message }; }
  return { ok: true, faecher: faecher.length };
}
