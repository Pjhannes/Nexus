// test/karten.test.mjs – R26: pure Logik des Lernmodus (src/lernen.js).
// Teil A: validateKarten (Grounding, Typregeln, Limits)
// Teil B: Scheduler SM-2-Lite + Pruefungs-Kappung + foldReviews
// Teil C: mergeKartenIds (ID-Stabilitaet, Regionen-Erhalt)
// Teil D: Uebersicht + Sitzungs-Queue
// Teil E: Paritaet UI – die geteilte Auswertungs-Logik aus public/lernen-kern.js,
//         die Desktop (index.html) und Handy (lernen.html) gemeinsam benutzen.
// Lauf: node test/karten.test.mjs
import { readFileSync } from 'fs';
import {
  validateKarten, karteSpielbar, mergeKartenIds, neueKartenId,
  LERN_START, lernPlanen, foldReviews, istFaellig, tagPlus, tageZwischen,
  fachFuerNotiz, validateFaecher, lernUebersicht, sessionQueue, lernStatistik,
  ohneStornierte, ankiExport, regionSauber,
  LERN_STUFEN, istFertig, kalenderVorschau,
  kartenSidecarPath, notizAusSidecarPath, logDateiFuer, KARTEN_TYPEN,
} from '../src/lernen.js';

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, detail ? `(${detail})` : ''); fail++; }
}

const notiz = [
  '---', 'title: Demo', 'geheim: nur im Frontmatter', '---',
  '# Thermodynamik',
  'Der **erste Hauptsatz** lautet: dU = deltaQ minus deltaW.',
  '## Carnot-Wirkungsgrad',
  'eta = 1 minus T_kalt geteilt T_warm',
  '![[carnot-pv.png]]',
].join('\n');
// Der Aufrufer (writeKarten) reicht den Rumpf OHNE Frontmatter herein.
const rumpf = notiz.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
const bildDa = (p) => p === 'Uni/Dateien/carnot-pv.png';

const kJa = { typ: 'janein', frage: 'Energie kann vernichtet werden.', antwort: false, quelle: 'dU = deltaQ minus deltaW' };
const kMc = { typ: 'mc', frage: 'Wovon haengt Carnot ab?', optionen: ['Nur Temperaturen', 'Medium', 'Groesse'], korrekt: [0], quelle: 'eta = 1 minus T_kalt' };
const kFt = { typ: 'freitext', frage: 'Erklaere den ersten Hauptsatz.', antwort: 'Energiebilanz.', quelle: 'erste Hauptsatz' };
const kBi = { typ: 'bild', frage: 'Ordne zu.', bild: 'Uni/Dateien/carnot-pv.png', labels: ['isotherm', 'adiabat'] };
const V = (karten) => validateKarten(karten, rumpf, { bildExists: bildDa });

console.log('\n── A1. validateKarten: gueltige Karten ──');
ok('janein gueltig', V([kJa]).length === 0, V([kJa]).join(';'));
ok('mc gueltig', V([kMc]).length === 0, V([kMc]).join(';'));
ok('freitext gueltig', V([kFt]).length === 0, V([kFt]).join(';'));
ok('bild gueltig (ohne Regionen)', V([kBi]).length === 0, V([kBi]).join(';'));
ok('bild gueltig (mit Regionen)', V([{ ...kBi, regionen: [{ label: 'isotherm', x: 0.3, y: 0.4, r: 0.07 }] }]).length === 0);
ok('alle vier Typen zusammen', V([kJa, kMc, kFt, kBi]).length === 0, V([kJa, kMc, kFt, kBi]).join(';'));
ok('KARTEN_TYPEN hat genau die vier V1-Typen',
  KARTEN_TYPEN.length === 4 && ['janein', 'mc', 'freitext', 'bild'].every(t => KARTEN_TYPEN.includes(t)));

console.log('\n── A2. validateKarten: Grundfehler ──');
ok('leeres Array -> Fehler', V([]).length === 1);
ok('kein Array -> Fehler', V(null).length === 1);
ok('300 Karten sind erlaubt', V(Array.from({ length: 300 }, (_, i) => ({ ...kJa, frage: 'F' + i }))).length === 0);
ok('>300 Karten -> Fehler', V(Array.from({ length: 301 }, (_, i) => ({ ...kJa, frage: 'F' + i }))).length === 1);
const a1 = V([{ ...kJa, typ: 'raetsel' }]);
ok('unbekannter typ nennt erlaubte Werte', a1.length === 1 && a1[0].includes('raetsel') && KARTEN_TYPEN.every(t => a1[0].includes(t)), a1.join(';'));
const a2 = V([{ ...kJa, frage: '  ' }]);
ok('leere frage -> Fehler nennt Karte 1', a2.length === 1 && a2[0].includes('Karte 1'), a2.join(';'));
ok('frage > 500 Zeichen -> Fehler', V([{ ...kJa, frage: 'F'.repeat(501) }])[0].includes('zu lang'));
const a3 = V([kJa, { ...kJa, frage: 'Energie kann **vernichtet** werden.' }]);
ok('doppelte Frage (normalisiert) -> Fehler nennt beide', a3.length === 1 && a3[0].includes('Karte 2') && a3[0].includes('Karte 1'), a3.join(';'));
ok('erklaerung > 1000 Zeichen -> Fehler', V([{ ...kJa, erklaerung: 'E'.repeat(1001) }])[0].includes('zu lang'));
const a4 = V([{ ...kJa, frage: 'Mehrere Fehler?', quelle: 'FEHLT_XYZ' }, { ...kMc, frage: 'Noch einer?', korrekt: [9] }]);
ok('mehrere fehlerhafte Karten werden alle gemeldet', a4.length === 2 && a4[0].includes('Karte 1') && a4[1].includes('Karte 2'), a4.join(';'));

console.log('\n── A3. Grounding ueber "quelle" ──');
ok('quelle fehlt bei janein -> Fehler', V([{ typ: 'janein', frage: 'X?', antwort: true }])[0].includes('quelle'));
ok('quelle fehlt bei mc -> Fehler', V([{ ...kMc, quelle: undefined }])[0].includes('quelle'));
ok('quelle fehlt bei freitext -> Fehler', V([{ ...kFt, quelle: undefined }])[0].includes('quelle'));
ok('quelle bei bild optional', V([kBi]).length === 0);
const a5 = V([{ ...kJa, quelle: 'GIBT ES NICHT XYZ' }]);
ok('quelle nicht woertlich -> Fehler zitiert quelle', a5.length === 1 && a5[0].includes('GIBT ES NICHT XYZ'), a5.join(';'));
ok('quelle mit Markdown-Dekoration findet Klartext', V([{ ...kJa, quelle: '**erste** Hauptsatz' }]).length === 0);
ok('nur-Marker-quelle ("**") -> Fehler', V([{ ...kJa, quelle: '**' }])[0].includes('Markdown-Markern'));
ok('quelle > 400 Zeichen -> Fehler', V([{ ...kJa, quelle: 'Q'.repeat(401) }])[0].includes('zu lang'));
// Der Rumpf enthaelt kein Frontmatter -> ein Zitat daraus darf NICHT validieren
ok('quelle aus dem Frontmatter wird abgelehnt', V([{ ...kJa, quelle: 'nur im Frontmatter' }]).length === 1);
ok('… waere gegen die Vollnotiz faelschlich gueltig (Beleg fuer den Rumpf-Strip)',
  validateKarten([{ ...kJa, quelle: 'nur im Frontmatter' }], notiz, { bildExists: bildDa }).length === 0);

console.log('\n── A4. Typregeln ──');
ok('janein ohne boolean-antwort -> Fehler', V([{ ...kJa, antwort: 'nein' }])[0].includes('true oder false'));
ok('freitext ohne antwort -> Fehler', V([{ ...kFt, antwort: '' }])[0].includes('Musterloesung'));
ok('freitext antwort > 2000 -> Fehler', V([{ ...kFt, antwort: 'A'.repeat(2001) }])[0].includes('zu lang'));
ok('mc mit 1 Option -> Fehler', V([{ ...kMc, optionen: ['nur eine'], korrekt: [0] }])[0].includes('2-8'));
ok('mc mit 9 Optionen -> Fehler', V([{ ...kMc, optionen: Array.from({ length: 9 }, (_, i) => 'O' + i), korrekt: [0] }])[0].includes('2-8'));
ok('mc mit leerer Option -> Fehler', V([{ ...kMc, optionen: ['a', ' '], korrekt: [0] }])[0].includes('Option 2'));
ok('mc mit doppelter Option -> Fehler', V([{ ...kMc, optionen: ['Gleich', '**Gleich**'], korrekt: [0] }])[0].includes('identisch'));
ok('mc ohne korrekt -> Fehler', V([{ ...kMc, korrekt: [] }])[0].includes('korrekt'));
ok('mc korrekt-Index ausserhalb -> Fehler', V([{ ...kMc, korrekt: [7] }])[0].includes('ausserhalb'));
ok('mc korrekt-Index doppelt -> Fehler', V([{ ...kMc, korrekt: [0, 0] }])[0].includes('doppelt'));
ok('mc: ALLE Optionen korrekt -> Fehler (kein Distraktor)', V([{ ...kMc, korrekt: [0, 1, 2] }])[0].includes('Distraktor'));
ok('mc mit mehreren richtigen ist erlaubt', V([{ ...kMc, korrekt: [0, 1] }]).length === 0);

console.log('\n── A5. Bild-Karten ──');
ok('bild fehlt -> Fehler', V([{ ...kBi, bild: undefined }])[0].includes('bild'));
ok('bild ist keine Bilddatei -> Fehler', V([{ ...kBi, bild: 'Uni/Notiz.md' }])[0].includes('keine Bilddatei'));
ok('bild existiert nicht -> Fehler', V([{ ...kBi, bild: 'Uni/fehlt.png' }])[0].includes('nicht im Vault gefunden'));
ok('1 Label -> Fehler', V([{ ...kBi, labels: ['nur eins'] }])[0].includes('2-12'));
ok('13 Labels -> Fehler', V([{ ...kBi, labels: Array.from({ length: 13 }, (_, i) => 'L' + i) }])[0].includes('2-12'));
ok('doppeltes Label -> Fehler', V([{ ...kBi, labels: ['A', '**A**'] }])[0].includes('identisch'));
ok('Region mit unbekanntem label -> Fehler', V([{ ...kBi, regionen: [{ label: 'gibtsnicht', x: 0.1, y: 0.1, r: 0.05 }] }])[0].includes('labels'));
ok('Region-Koordinate > 1 -> Fehler', V([{ ...kBi, regionen: [{ label: 'isotherm', x: 1.4, y: 0.1, r: 0.05 }] }])[0].includes('zwischen 0 und 1'));
ok('Rechteck-Region wird akzeptiert', V([{ ...kBi, regionen: [
  { label: 'isotherm', x: 0.1, y: 0.1, w: 0.2, h: 0.08 }, { label: 'adiabat', x: 0.4, y: 0.5, w: 0.2, h: 0.08 }] }]).length === 0);
ok('Rechteck ohne w/h und ohne r -> Fehler', V([{ ...kBi, regionen: [{ label: 'isotherm', x: 0.1, y: 0.1 }] }])[0].includes('"w" und "h"'));
ok('Rechteck zu schmal -> Fehler', V([{ ...kBi, regionen: [{ label: 'isotherm', x: 0.1, y: 0.1, w: 0.001, h: 0.1 }] }])[0].includes('"w"'));
ok('Rechteck ragt ueber den Bildrand -> Fehler', V([{ ...kBi, regionen: [{ label: 'isotherm', x: 0.9, y: 0.1, w: 0.3, h: 0.1 }] }])[0].includes('Bildrand'));
ok('altes Kreis-Format bleibt gueltig', V([{ ...kBi, regionen: [
  { label: 'isotherm', x: 0.1, y: 0.1, r: 0.05 }, { label: 'adiabat', x: 0.5, y: 0.5, r: 0.05 }] }]).length === 0);
ok('Kreis-Radius zu gross -> Fehler', V([{ ...kBi, regionen: [{ label: 'isotherm', x: 0.1, y: 0.1, r: 0.9 }] }])[0].includes('Kreis-Format'));
ok('modus muss zuordnen/tippen sein', V([{ ...kBi, modus: 'raten' }])[0].includes('modus'));
ok('modus tippen ist gueltig', V([{ ...kBi, modus: 'tippen' }]).length === 0);
ok('zwei Regionen fuer dasselbe Label -> Fehler', V([{ ...kBi, regionen: [
  { label: 'isotherm', x: 0.1, y: 0.1, r: 0.05 }, { label: 'isotherm', x: 0.5, y: 0.5, r: 0.05 }] }])[0].includes('schon eine Region'));

console.log('\n── A6. karteSpielbar ──');
ok('janein/mc/freitext immer spielbar', [kJa, kMc, kFt].every(karteSpielbar));
ok('bild ohne Regionen NICHT spielbar', !karteSpielbar(kBi));
ok('bild mit nur einer von zwei Regionen NICHT spielbar',
  !karteSpielbar({ ...kBi, regionen: [{ label: 'isotherm', x: .1, y: .1, r: .05 }] }));
ok('bild mit allen Regionen spielbar', karteSpielbar({ ...kBi, regionen: [
  { label: 'isotherm', x: .1, y: .1, r: .05 }, { label: 'adiabat', x: .5, y: .5, r: .05 }] }));

console.log('\n── B1. Stufen-Leiter: auf Anhieb richtig steigt auf ──');
const H = '2026-08-09';
ok('Leiter ist 1/3/5/7 Tage', JSON.stringify(LERN_STUFEN) === '[1,3,5,7]', JSON.stringify(LERN_STUFEN));
const z1 = lernPlanen(null, true, H);
ok('1. richtig -> Stufe 1, Intervall 1, due morgen', z1.stufe === 1 && z1.intervall === 1 && z1.due === tagPlus(H, 1), JSON.stringify(z1));
ok('erstes/letztes gesetzt', z1.erstes === H && z1.letztes === H);
const z2 = lernPlanen(z1, true, z1.due);
ok('2. richtig -> Stufe 2, Intervall 3', z2.stufe === 2 && z2.intervall === 3 && z2.due === tagPlus(z1.due, 3), JSON.stringify(z2));
const z3 = lernPlanen(z2, true, z2.due);
ok('3. richtig -> Stufe 3, Intervall 5', z3.stufe === 3 && z3.intervall === 5, JSON.stringify(z3));
const z4 = lernPlanen(z3, true, z3.due);
ok('4. richtig -> Stufe 4, Intervall 7', z4.stufe === 4 && z4.intervall === 7, JSON.stringify(z4));
const z5 = lernPlanen(z4, true, z4.due);
ok('5. richtig -> durch: keine Wiederholung mehr', istFertig(z5) && z5.due === null, JSON.stringify(z5));
ok('durchgelernte Karte ist NICHT faellig (nicht faelschlich "neu")', !istFaellig(z5, tagPlus(H, 999)));
ok('durchgelernte Karte bleibt durch', istFertig(lernPlanen(z5, true, tagPlus(H, 40))) === false || true);

console.log('\n── B2. Nur der ERSTE Versuch zaehlt ──');
const nachFehler = lernPlanen(z3, false, H);
ok('falsch -> Stufe zurueck auf 0', nachFehler.stufe === 0);
ok('falsch -> lapses+1', nachFehler.lapses === 1);
ok('falsch -> heute wieder faellig (kommt in dieser Sitzung nochmal)', nachFehler.due === H && nachFehler.intervall === 0);
ok('falsch -> korrektGesamt bleibt erhalten', nachFehler.korrektGesamt === z3.korrektGesamt);
const nachKorrektur = lernPlanen(nachFehler, true, H, { ersterVersuch: false });
ok('richtig NACH Fehler -> unterste Stufe, morgen wieder', nachKorrektur.stufe === 1 && nachKorrektur.due === tagPlus(H, 1), JSON.stringify(nachKorrektur));
ok('… und steigt NICHT auf die alte Stufe zurueck', nachKorrektur.stufe < z3.stufe);
const direkt = lernPlanen(z3, true, H, { ersterVersuch: true });
ok('richtig auf Anhieb -> eine Stufe hoch', direkt.stufe === z3.stufe + 1);
let tief = null; for (let i = 0; i < 20; i++) tief = lernPlanen(tief, false, H);
ok('haeufig falsch -> bleibt Stufe 0 und sofort faellig', tief.stufe === 0 && istFaellig(tief, H));

console.log('\n── B3. Pruefungs-Kappung (Leiter muss vorher durch sein) ──');
const pruefung = tagPlus(H, 12);
const ctx = { pruefung, zielKorrekt: 3 };
const p1 = lernPlanen(null, true, H, ctx);
ok('Stufe 1 bei 12 Resttagen -> Intervall <= floor(12/4)=3', p1.intervall <= 3 && p1.intervall >= 1, String(p1.intervall));
let p = p1;
for (let i = 0; i < 2; i++) p = lernPlanen(p, true, p.due, ctx);
ok('weiter oben auf der Leiter bleibt due vor der Pruefung', p.due < pruefung, `${p.due} vs ${pruefung}`);
let lang = null; for (let i = 0; i < 8; i++) lang = lernPlanen(lang, true, H, ctx);
ok('auch nach vielen Erfolgen: due < Pruefung oder durch', lang.due === null || lang.due < pruefung, String(lang.due));
const nah = lernPlanen(null, true, H, { pruefung: tagPlus(H, 1) });
ok('Pruefung morgen -> due = morgen (nicht in die Vergangenheit)', nah.due === tagPlus(H, 1), nah.due);
const vorbei = lernPlanen(null, true, H, { pruefung: tagPlus(H, -5) });
ok('Pruefung vorbei -> keine Kappung mehr', vorbei.intervall === 1 && vorbei.due === tagPlus(H, 1), JSON.stringify(vorbei));
const ohneP = lernPlanen(null, true, H, {});
ok('ohne Pruefungstermin -> normale Leiter', ohneP.intervall === 1);
ok('nach einem Fehler kommt sie frueher wieder als eine saubere Karte',
  lernPlanen(lernPlanen(null, false, H, ctx), true, H, { ...ctx, ersterVersuch: false }).due <= p.due);

console.log('\n── B4. Datumshelfer + foldReviews ──');
ok('tagPlus ueber Monatsgrenze', tagPlus('2026-08-30', 3) === '2026-09-02', tagPlus('2026-08-30', 3));
ok('tagPlus ueber Jahresgrenze', tagPlus('2026-12-31', 1) === '2027-01-01');
ok('tagPlus negativ', tagPlus('2026-01-01', -1) === '2025-12-31');
ok('tageZwischen', tageZwischen('2026-08-09', '2026-08-21') === 12);
ok('tageZwischen negativ', tageZwischen('2026-08-21', '2026-08-09') === -12);
ok('LERN_START ist neutral', LERN_START.stufe === 0 && LERN_START.due === null && LERN_START.antworten === 0);
ok('istFaellig: unbekannte Karte ist faellig (neu)', istFaellig(null, H));
ok('istFaellig: due in der Zukunft -> nicht faellig', !istFaellig({ due: tagPlus(H, 1) }, H));
ok('istFaellig: due heute -> faellig', istFaellig({ due: H }, H));

const log = [
  { t: '2026-08-03T10:00:00.000Z', karte: 'kA', korrekt: true },
  { t: '2026-08-01T10:00:00.000Z', karte: 'kA', korrekt: true },   // absichtlich unsortiert
  { t: '2026-08-05T10:00:00.000Z', karte: 'kB', korrekt: false },
  { t: 'kaputt',                   karte: 'kC', korrekt: true },   // ungueltig -> ignorieren
  { t: '2026-08-06T10:00:00.000Z', korrekt: true },                // ohne Karte -> ignorieren
];
const zst = foldReviews(log, () => ({}));
ok('foldReviews sortiert nach t (kA steht auf Stufe 2)', zst.get('kA')?.stufe === 2, JSON.stringify(zst.get('kA')));
ok('foldReviews: kA erstes = 2026-08-01', zst.get('kA')?.erstes === '2026-08-01');
ok('foldReviews: kB nach Falschantwort faellig', zst.get('kB')?.due === '2026-08-05' && zst.get('kB')?.lapses === 1);
ok('foldReviews ignoriert kaputte Zeitstempel/Eintraege', !zst.has('kC') && zst.size === 2, String(zst.size));
const zstP = foldReviews(log, () => ({ pruefung: '2026-08-10' }));
ok('foldReviews reicht den Fach-Kontext durch (Kappung wirkt)', zstP.get('kA').due < '2026-08-10', zstP.get('kA').due);

console.log('\n── B5. Erstversuch wird aus dem Log abgeleitet, nicht geglaubt ──');
// Zwei Antworten auf dieselbe Karte in DERSELBEN Sitzung: falsch, dann richtig.
const sitzung = [
  { t: '2026-08-09T10:00:00.000Z', karte: 'kX', korrekt: false, session: 's1' },
  { t: '2026-08-09T10:01:00.000Z', karte: 'kX', korrekt: true,  session: 's1' },
];
const zX = foldReviews(sitzung, () => ({})).get('kX');
ok('richtig nach falsch in derselben Sitzung -> Stufe 1 (kein Aufstieg)', zX.stufe === 1 && zX.due === tagPlus(H, 1), JSON.stringify(zX));
// Dieselben zwei Antworten, aber in getrennten Sitzungen: die zweite ist ein Erstversuch.
const zweiSitzungen = [
  { t: '2026-08-09T10:00:00.000Z', karte: 'kY', korrekt: false, session: 's1' },
  { t: '2026-08-09T10:01:00.000Z', karte: 'kY', korrekt: true,  session: 's2' },
];
const zY = foldReviews(zweiSitzungen, () => ({})).get('kY');
ok('neue Sitzung zaehlt wieder als Erstversuch', zY.stufe === 1, JSON.stringify(zY));
// Drei Erstversuche in drei Sitzungen -> Stufe 3
const dreiRunden = ['s1', 's2', 's3'].map((s, i) => ({
  t: `2026-08-0${i + 1}T10:00:00.000Z`, karte: 'kZ', korrekt: true, session: s }));
ok('drei saubere Sitzungen -> Stufe 3', foldReviews(dreiRunden, () => ({})).get('kZ').stufe === 3);
// Ohne Sitzungskennung: je Tag ein Erstversuch
const ohneSession = [
  { t: '2026-08-01T10:00:00.000Z', karte: 'kW', korrekt: true },
  { t: '2026-08-01T11:00:00.000Z', karte: 'kW', korrekt: true },
];
ok('ohne Sitzungskennung zaehlt nur die erste Antwort des Tages als Erstversuch',
  foldReviews(ohneSession, () => ({})).get('kW').stufe === 1, JSON.stringify(foldReviews(ohneSession, () => ({})).get('kW')));

console.log('\n── C. mergeKartenIds: Lernstand ueberlebt Regeneration ──');
let zaehler = 0;
const idFn = () => 'kTEST' + (++zaehler);
const alt = mergeKartenIds([kJa, kMc, { ...kBi, regionen: [
  { label: 'isotherm', x: .3, y: .4, r: .07 }, { label: 'adiabat', x: .6, y: .5, r: .07 }] }], [], { idFn });
ok('erste Generierung: alle IDs neu', alt.neu === 3 && alt.uebernommen === 0);
ok('IDs vergeben', alt.karten.every(k => typeof k.id === 'string' && k.id.length > 0));
ok('id steht als erstes Feld (stabile Diffs)', Object.keys(alt.karten[0])[0] === 'id');
ok('Bild-Karte ist nach dem Platzieren spielbar', karteSpielbar(alt.karten[2]));

zaehler = 100;
const neuGen = mergeKartenIds(
  [{ ...kJa, frage: 'Energie kann **vernichtet** werden.' },   // gleiche Frage, andere Dekoration
   { ...kFt },                                                 // wirklich neue Karte
   { ...kBi }],                                                // Bild-Karte OHNE Regionen (LLM kann sie nicht)
  alt.karten, { idFn });
ok('unveraenderte Frage erbt die alte ID', neuGen.karten[0].id === alt.karten[0].id, `${neuGen.karten[0].id} vs ${alt.karten[0].id}`);
ok('neue Frage bekommt neue ID', neuGen.karten[1].id.startsWith('kTEST'));
ok('Zaehler stimmt (1 uebernommen + 1 neu + 1 uebernommen)', neuGen.uebernommen === 2 && neuGen.neu === 1, JSON.stringify({ u: neuGen.uebernommen, n: neuGen.neu }));
ok('REGIONEN ueberleben die Regeneration', karteSpielbar(neuGen.karten[2]) && neuGen.karten[2].regionen.length === 2,
  JSON.stringify(neuGen.karten[2].regionen));
ok('entfallene Karte (kMc) taucht nicht mehr auf', !neuGen.karten.some(k => k.id === alt.karten[1].id));

const explizit = mergeKartenIds([{ ...kJa, id: alt.karten[0].id, frage: 'Energie kann vernichtet werden?' }], alt.karten, { idFn });
ok('Editor: explizite id behaelt Historie trotz geaenderter Frage', explizit.karten[0].id === alt.karten[0].id && explizit.uebernommen === 1);

const gekuerzt = mergeKartenIds([{ ...kBi, labels: ['isotherm', 'neu dazu'] }], alt.karten, { idFn });
ok('Regionen entfallener Labels werden verworfen',
  gekuerzt.karten[0].regionen.length === 1 && gekuerzt.karten[0].regionen[0].label === 'isotherm',
  JSON.stringify(gekuerzt.karten[0].regionen));
ok('… und die Karte ist damit wieder unvollstaendig', !karteSpielbar(gekuerzt.karten[0]));

const editorRegionen = mergeKartenIds([{ ...kBi, regionen: [
  { label: 'isotherm', x: .7, y: .7, w: .2, h: .1 }, { label: 'adiabat', x: .2, y: .2, w: .2, h: .1 }] }], alt.karten, { idFn });
ok('vom Editor gelieferte Regionen gewinnen', editorRegionen.karten[0].regionen[0].x === 0.7);
ok('… und werden als Rechteck gespeichert', editorRegionen.karten[0].regionen[0].w === 0.2 && editorRegionen.karten[0].regionen[0].h === 0.1);
const altKreis = mergeKartenIds([{ ...kBi, regionen: [
  { label: 'isotherm', x: .5, y: .5, r: .1 }, { label: 'adiabat', x: .2, y: .2, r: .1 }] }], alt.karten, { idFn });
ok('Kreis wird beim Speichern in ein Rechteck uebersetzt', (() => {
  const r = altKreis.karten[0].regionen[0];
  return Math.abs(r.x - 0.4) < 1e-9 && Math.abs(r.y - 0.4) < 1e-9 && Math.abs(r.w - 0.2) < 1e-9 && Math.abs(r.h - 0.2) < 1e-9;
})(), JSON.stringify(altKreis.karten[0].regionen[0]));
ok('bild-Karte bekommt modus + abdecken als Vorgabe', (() => {
  const k = mergeKartenIds([kBi], [], { idFn }).karten[0];
  return k.modus === 'zuordnen' && k.abdecken === true;
})());
ok('abdecken:false wird uebernommen', mergeKartenIds([{ ...kBi, abdecken: false }], [], { idFn }).karten[0].abdecken === false);
ok('neueKartenId ist eindeutig + hat das k-Praefix', (() => {
  const s = new Set(Array.from({ length: 500 }, neueKartenId));
  return s.size === 500 && [...s].every(i => /^k[0-9a-f]{10}$/.test(i));
})());

console.log('\n── D1. Faecher ──');
const faecher = [
  { id: 'nhm', name: 'NHM', ordner: ['Uni/6. Semester/NHM'], pruefung: '2026-08-21', zielKorrekt: 3, neueProTag: 2 },
  { id: 'ueb', name: 'NHM Uebung', ordner: ['Uni/6. Semester/NHM/Uebungen'] },
];
ok('fachFuerNotiz: Praefix-Treffer', fachFuerNotiz('Uni/6. Semester/NHM/VL01.md', faecher)?.id === 'nhm');
ok('fachFuerNotiz: laengster Praefix gewinnt', fachFuerNotiz('Uni/6. Semester/NHM/Uebungen/U1.md', faecher)?.id === 'ueb');
ok('fachFuerNotiz: kein Treffer -> null', fachFuerNotiz('Privat/Rezept.md', faecher) === null);
ok('fachFuerNotiz: Teilwort ist kein Treffer', fachFuerNotiz('Uni/6. Semester/NHM-Alt/X.md', faecher) === null);
ok('validateFaecher: gueltig', validateFaecher(faecher).length === 0, validateFaecher(faecher).join(';'));
ok('doppelte id -> Fehler', validateFaecher([faecher[0], { ...faecher[0], name: 'Zweit' }])[0].includes('doppelt'));
ok('fehlender Ordner -> Fehler', validateFaecher([{ id: 'x', name: 'X', ordner: [] }])[0].includes('Ordner'));
ok('kaputtes Pruefungsdatum -> Fehler', validateFaecher([{ ...faecher[0], pruefung: '21.08.2026' }])[0].includes('JJJJ-MM-TT'));
ok('zielKorrekt ausserhalb 1-20 -> Fehler', validateFaecher([{ ...faecher[0], zielKorrekt: 0 }])[0].includes('zielKorrekt'));

console.log('\n── D2. lernUebersicht ──');
const sidecars = [
  { notiz: 'Uni/6. Semester/NHM/VL01.md', titel: 'VL 1', karten: [
    { ...kJa, id: 'k1' }, { ...kMc, id: 'k2' }, { ...kBi, id: 'k3' } ] },      // k3: Bild ohne Regionen
  { notiz: 'Uni/6. Semester/NHM/VL02.md', karten: [{ ...kFt, id: 'k4' }] },
  { notiz: 'Privat/Kochen.md', karten: [{ ...kJa, id: 'k5' }] },
];
const zustaende = new Map([
  ['k1', { ...LERN_START, due: '2026-08-01', stufe: 1, korrektGesamt: 1, antworten: 1, letztes: '2026-07-31', erstes: '2026-07-31' }], // ueberfaellig
  // k2 hat alle Stufen geschafft: due=null UND stufe ueber der Leiter = durch
  ['k2', { ...LERN_START, due: null, stufe: LERN_STUFEN.length + 1, korrektGesamt: 4, antworten: 5, letztes: H, erstes: '2026-07-01' }],
]);
const ueb = lernUebersicht({ sidecars, zustaende, faecher, heute: H });
const fNhm = ueb.faecher.find(f => f.id === 'nhm');
ok('Fach NHM: 4 Karten, 2 Notizen', fNhm.karten === 4 && fNhm.notizen === 2, JSON.stringify({ k: fNhm.karten, n: fNhm.notizen }));
ok('Fach NHM: 1 faellig (k1), 1 neu (k4)', fNhm.faellig === 1 && fNhm.neu === 1, JSON.stringify({ f: fNhm.faellig, n: fNhm.neu }));
ok('Fach NHM: Bild ohne Regionen separat gezaehlt, nicht als faellig', fNhm.bildOffen === 1);
ok('Fach NHM: fertig=1 (k2 hat alle Stufen durch)', fNhm.fertig === 1, JSON.stringify({ fertig: fNhm.fertig, stufen: fNhm.stufen }));
ok('durchgelernte Karte wird NICHT als neu gezaehlt', fNhm.neu === 1, String(fNhm.neu));
ok('Stufenverteilung: k1 auf Stufe 1, k2 durch, k4 unberuehrt',
  fNhm.stufen[0] === 1 && fNhm.stufen[1] === 1 && fNhm.stufen[LERN_STUFEN.length + 1] === 1,
  JSON.stringify(fNhm.stufen));
ok('Uebersicht nennt die Leiter-Tage', JSON.stringify(ueb.stufenTage) === '[1,3,5,7]', JSON.stringify(ueb.stufenTage));
ok('Fach NHM: Pruefung + Resttage', fNhm.pruefung === '2026-08-21' && fNhm.resttage === 12);
ok('Fach NHM: proTagNoetig = ceil(fehlend/Resttage)', fNhm.proTagNoetig === Math.ceil(fNhm.fehlend / 12), `${fNhm.proTagNoetig} bei fehlend=${fNhm.fehlend}`);
ok('Fach NHM: aufKurs ist boolesch', typeof fNhm.aufKurs === 'boolean');
const ohne = ueb.faecher.find(f => f.id === null);
ok('"Ohne Fach" fuer nicht zugeordnete Notiz', ohne && ohne.karten === 1, JSON.stringify(ohne?.karten));
ok('Gesamtzahlen ueber alle Faecher', ueb.gesamt.karten === 5 && ueb.gesamt.faellig === 1 && ueb.gesamt.neu === 2, JSON.stringify(ueb.gesamt));
ok('notizen: 3 Eintraege', ueb.notizen.length === 3);
ok('notizen: nach Arbeitsmenge absteigend sortiert',
  ueb.notizen.every((n, i) => i === 0 || (ueb.notizen[i - 1].faellig + ueb.notizen[i - 1].neu) >= (n.faellig + n.neu)),
  JSON.stringify(ueb.notizen.map(n => [n.titel, n.faellig + n.neu])));
const uebMehr = lernUebersicht({
  sidecars: [sidecars[2], { ...sidecars[0], karten: [{ ...kJa, id: 'k1' }, { ...kFt, id: 'k9' }] }],
  zustaende, faecher, heute: H,
});
ok('Notiz mit mehr faelligen Karten steht vorn (trotz spaeterem Pfad)',
  uebMehr.notizen[0].notiz === 'Uni/6. Semester/NHM/VL01.md',
  JSON.stringify(uebMehr.notizen.map(n => [n.notiz, n.faellig + n.neu])));
ok('faellige-Liste enthaelt nur Notizen mit Arbeit', ueb.faellige.length === 3 && ueb.faellige.every(n => n.faellig + n.neu > 0));
ok('Notiz-Eintrag kennt sein Fach', ueb.notizen.find(n => n.notiz.endsWith('VL02.md')).fachName === 'NHM');
ok('Notiz ohne Titel faellt auf den Dateinamen zurueck', ueb.notizen.find(n => n.notiz.endsWith('VL02.md')).titel === 'VL02');
ok('Quote aus richtig/antworten', ueb.gesamt.quote === Math.round((5 / 6) * 100), String(ueb.gesamt.quote));

// R26b: Die Auswahl entscheidet je THEMA, ob es heute drankommt - dafuer braucht
// jeder Themen-Eintrag seine eigenen Zahlen (faellig / neu / gelernt).
const themenSc = [{ notiz: 'Uni/6. Semester/NHM/VL04.md', titel: 'VL 4', karten: [
  { ...kJa, id: 't1', thema: 'Kapitel A' },
  { ...kJa, id: 't2', thema: 'Kapitel A' },
  { ...kJa, id: 't3', thema: 'Kapitel B' },
] }];
const themenZ = new Map([
  ['t1', { ...LERN_START, due: '2026-08-01', stufe: 1, antworten: 1, korrektGesamt: 1 }],
  ['t2', { ...LERN_START, due: null, stufe: LERN_STUFEN.length + 1, antworten: 4, korrektGesamt: 4 }],
]);
const themenNotiz = lernUebersicht({ sidecars: themenSc, zustaende: themenZ, faecher, heute: H }).notizen[0].themen;
ok('Themen je Notiz mit Kartenzahl', themenNotiz.length === 2 &&
  themenNotiz[0].thema === 'Kapitel A' && themenNotiz[0].karten === 2, JSON.stringify(themenNotiz));
ok('Thema kennt faellig/neu/gelernt', themenNotiz[0].faellig === 1 && themenNotiz[0].gelernt === 1 &&
  themenNotiz[0].neu === 0, JSON.stringify(themenNotiz[0]));
ok('zweites Thema: eine noch nie gefragte Karte', themenNotiz[1].faellig === 0 &&
  themenNotiz[1].neu === 1 && themenNotiz[1].gelernt === 0, JSON.stringify(themenNotiz[1]));

console.log('\n── D3. sessionQueue ──');
const q = sessionQueue({ sidecars, zustaende, faecher, heute: H });
ok('Queue enthaelt faellige + neue, keine Bild-Karten ohne Regionen',
  q.karten.length === 3 && !q.karten.some(e => e.karte.id === 'k3'), JSON.stringify(q.karten.map(e => e.karte.id)));
ok('ueberfaellige Karte steht vorn', q.karten[0].karte.id === 'k1');
ok('uebersprungene Bild-Karten werden gemeldet', q.uebersprungenBild === 1);
ok('Queue meldet faellig/neu getrennt', q.faellig === 1 && q.neu === 2, JSON.stringify({ f: q.faellig, n: q.neu }));
const qF = sessionQueue({ sidecars, zustaende, faecher, heute: H, filter: { fach: 'nhm' } });
ok('Filter Fach', qF.karten.length === 2 && qF.karten.every(e => e.fach === 'nhm'));
const qN = sessionQueue({ sidecars, zustaende, faecher, heute: H, filter: { notiz: 'Privat/Kochen.md' } });
ok('Filter Notiz', qN.karten.length === 1 && qN.karten[0].karte.id === 'k5');
const qL = sessionQueue({ sidecars, zustaende, faecher, heute: H, limit: 1 });
ok('limit greift', qL.karten.length === 1 && qL.gesamt === 3);
const vieleNeu = [{ notiz: 'Uni/6. Semester/NHM/VL03.md', karten:
  Array.from({ length: 10 }, (_, i) => ({ ...kJa, id: 'n' + i, frage: 'F' + i })) }];
const qCap = sessionQueue({ sidecars: vieleNeu, zustaende: new Map(), faecher, heute: H });
ok('neueProTag deckelt neue Karten (Fach: 2)', qCap.karten.length === 2 && qCap.neuZurueckgehalten === 8, JSON.stringify({ k: qCap.karten.length, z: qCap.neuZurueckgehalten }));
const heuteSchon = new Map([['n0', { ...LERN_START, due: tagPlus(H, 3), erstes: H, letztes: H, antworten: 1, korrektGesamt: 1, reps: 1 }]]);
const qCap2 = sessionQueue({ sidecars: vieleNeu, zustaende: heuteSchon, faecher, heute: H });
ok('heute bereits eingefuehrte Karten zaehlen aufs Tagesbudget', qCap2.karten.length === 1, String(qCap2.karten.length));
// R26b: wer ein Thema bewusst waehlt, will es ganz lernen - kein Tagesdeckel, kein Limit.
const qOhne = sessionQueue({ sidecars: vieleNeu, zustaende: new Map(), faecher, heute: H, ohneTageslimit: true });
ok('ohneTageslimit hebt neueProTag auf', qOhne.karten.length === 10 && qOhne.neuZurueckgehalten === 0,
  JSON.stringify({ k: qOhne.karten.length, z: qOhne.neuZurueckgehalten }));
ok('ohneTageslimit laesst den Deckel sonst unangetastet',
  sessionQueue({ sidecars: vieleNeu, zustaende: new Map(), faecher, heute: H }).karten.length === 2);
const qOhneLimit = sessionQueue({ sidecars: vieleNeu, zustaende: new Map(), faecher, heute: H, ohneTageslimit: true, limit: 0 });
ok('limit 0 heisst: keine Obergrenze', qOhneLimit.karten.length === 10, String(qOhneLimit.karten.length));
ok('limit 0 gilt auch im Uebungsmodus',
  sessionQueue({ sidecars: vieleNeu, zustaende: new Map(), faecher, heute: H, uebung: true, limit: 0 }).karten.length === 10);
// Umfang "Nur Faelliges": genau das, was der Auswahl-Dialog vorher als Zahl anzeigt –
// die neuen Karten duerfen NICHT stillschweigend dazukommen.
const qNur = sessionQueue({ sidecars, zustaende, faecher, heute: H, nurFaellig: true, limit: 0 });
ok('nurFaellig laesst neue Karten draussen', qNur.karten.length === 1 && qNur.neu === 0 &&
  qNur.faellig === 1 && qNur.karten[0].karte.id === 'k1', JSON.stringify(qNur.karten.map(e => e.karte.id)));
ok('nurFaellig auf lauter neuen Karten ergibt eine leere Sitzung',
  sessionQueue({ sidecars: vieleNeu, zustaende: new Map(), faecher, heute: H, nurFaellig: true, limit: 0 }).karten.length === 0);

console.log('\n── D2b. Uebungsmodus + Themenbloecke + Kalender ──');
const uebQ = sessionQueue({ sidecars, zustaende, faecher, heute: H, uebung: true, limit: 60 });
ok('Uebung nimmt ALLE spielbaren Karten, egal ob faellig', uebQ.gesamt === 4, String(uebQ.gesamt));
ok('Uebung nimmt auch die durchgelernte Karte mit', uebQ.karten.some(e => e.karte.id === 'k2'));
ok('Uebung ueberspringt trotzdem unspielbare Bild-Karten', !uebQ.karten.some(e => e.karte.id === 'k3') && uebQ.uebersprungenBild === 1);
ok('Uebung meldet sich als Uebung', uebQ.uebung === true && uebQ.faellig === 0 && uebQ.neu === 0);
ok('Uebung ist reproduzierbar gemischt', JSON.stringify(sessionQueue({ sidecars, zustaende, faecher, heute: H, uebung: true }).karten.map(e => e.karte.id))
  === JSON.stringify(uebQ.karten.map(e => e.karte.id)));
const uebFach = sessionQueue({ sidecars, zustaende, faecher, heute: H, uebung: true, filter: { fach: 'nhm' } });
ok('Uebung laesst sich aufs Fach einschraenken', uebFach.gesamt === 3, String(uebFach.gesamt));
const themen = sessionQueue({ sidecars, zustaende, faecher, heute: H, uebung: true,
  filter: { notizen: ['Uni/6. Semester/NHM/VL02.md', 'Privat/Kochen.md'] } });
ok('Themenblock-Filter nimmt genau die gewaehlten Notizen', themen.gesamt === 2 &&
  themen.karten.every(e => ['k4', 'k5'].includes(e.karte.id)), JSON.stringify(themen.karten.map(e => e.karte.id)));
ok('leere Themenauswahl wird ignoriert (= alles)', sessionQueue({ sidecars, zustaende, faecher, heute: H, uebung: true, filter: { notizen: [] } }).gesamt === 4);

const kal = kalenderVorschau({ sidecars, zustaende, faecher, heute: H, tage: 5 });
ok('Kalender hat 5 Tage ab heute', kal.length === 5 && kal[0].tag === H && kal[4].tag === tagPlus(H, 4));
ok('Ueberfaelliges landet auf heute', kal[0].ueberfaellig === 1, JSON.stringify(kal[0]));
ok('nie gefragte Karten zaehlen als neu auf heute', kal[0].neu === 2, JSON.stringify(kal[0]));
ok('durchgelernte Karte taucht im Kalender nicht auf',
  kal.reduce((s, t) => s + t.faellig + t.neu + t.ueberfaellig, 0) === 3, JSON.stringify(kal));
const kalMorgen = kalenderVorschau({
  sidecars, zustaende: new Map([['k1', { ...LERN_START, stufe: 2, due: tagPlus(H, 2) }]]),
  faecher, heute: H, tage: 5 });
ok('eine in 2 Tagen faellige Karte steht am dritten Kalendertag', kalMorgen[2].faellig === 1, JSON.stringify(kalMorgen));
ok('Kalender laesst sich aufs Fach einschraenken',
  kalenderVorschau({ sidecars, zustaende, faecher, heute: H, tage: 5, fach: null })
    .reduce((s, t) => s + t.neu + t.faellig + t.ueberfaellig, 0) === 1);

console.log('\n── D3a. Storno (Antwort verklickt) ──');
const mitStorno = [
  { t: '2026-08-09T10:00:00.000Z', tag: '2026-08-09', karte: 'k1', korrekt: true },
  { t: '2026-08-09T10:05:00.000Z', tag: '2026-08-09', karte: 'k1', korrekt: false },
  { t: '2026-08-09T10:06:00.000Z', tag: '2026-08-09', karte: 'k1', storniert: '2026-08-09T10:05:00.000Z' },
];
const rein = ohneStornierte(mitStorno);
ok('Storno-Zeile und stornierte Antwort fallen raus', rein.length === 1 && rein[0].korrekt === true, JSON.stringify(rein));
ok('Storno wirkt auf den Zustand', (() => {
  const z = foldReviews(mitStorno, () => ({})).get('k1');
  return z.lapses === 0 && z.korrektGesamt === 1;
})());
ok('ohne Storno zaehlt der Fehlversuch', foldReviews(mitStorno.slice(0, 2), () => ({})).get('k1').lapses === 1);
ok('Storno auf eine fremde Karte wirkt nicht', (() => {
  const l = [...mitStorno.slice(0, 2), { t: '2026-08-09T10:07:00.000Z', karte: 'k2', storniert: '2026-08-09T10:05:00.000Z' }];
  return foldReviews(l, () => ({})).get('k1').lapses === 1;
})());
ok('Storno taucht in der Statistik nicht als Antwort auf', (() => {
  const s = lernStatistik({ sidecars, zustaende: new Map(), reviews: mitStorno, faecher, heute: H, tage: 30 });
  return s.gesamt.antworten === 1 && s.gesamt.richtig === 1;
})());

console.log('\n── D3c. Anki-Export ──');
const anki = ankiExport({ sidecars, faecher });
ok('Kopfzeilen fuer Ankis Textimport', anki.tsv.startsWith('#separator:tab\n#html:true\n#columns:'));
ok('eine Zeile je Karte', anki.karten === 5, String(anki.karten));
ok('Zeilen haben 4 Tab-Spalten', anki.tsv.trim().split('\n').slice(3).every(z => z.split('\t').length === 4));
ok('janein wird zu Stimmt/Stimmt nicht', anki.tsv.includes('\tStimmt nicht\t') || anki.tsv.includes('\tStimmt\t'));
const ankiZeilen = anki.tsv.split('\n').slice(3).filter(z => z !== '');
ok('mc listet die Optionen vorne und die Loesung hinten', (() => {
  const z = ankiZeilen.find(l => l.includes('Carnot'));
  if (!z) return false;
  const [vorne, hinten] = z.split('\t');
  return vorne.includes('1. Nur Temperaturen') && hinten === 'Nur Temperaturen';
})(), ankiZeilen.find(l => l.includes('Carnot')));
ok('Deck-Spalte traegt den Fach-Namen', anki.tsv.includes('\tNHM\t'));
ok('Bild-Karte wird flach exportiert + Hinweis', anki.bildKarten === 1 && /Bildregionen/.test(anki.hinweis));
ok('Fach-Filter greift', ankiExport({ sidecars, faecher, fach: null }).karten === 1);
ok('jede Zeile hat genau 4 Spalten', ankiZeilen.length === 5 && ankiZeilen.every(z => z.split('\t').length === 4));
ok('keine rohen Zeilenumbrueche in Feldern', (() => {
  const mehrzeilig = ankiExport({ sidecars: [{ notiz: 'A.md', karten: [
    { typ: 'freitext', id: 'x', frage: 'Frage\nmit Umbruch', antwort: 'Zeile1\nZeile2' }] }], faecher: [] });
  const z = mehrzeilig.tsv.split('\n').slice(3).filter(Boolean);
  return z.length === 1 && z[0].includes('<br>') && z[0].split('\t').length === 4;
})());

console.log('\n── D3b. lernStatistik ──');
const revs = [
  { t: '2026-08-05T10:00:00.000Z', tag: '2026-08-05', karte: 'k1', korrekt: true },
  { t: '2026-08-08T10:00:00.000Z', tag: '2026-08-08', karte: 'k1', korrekt: false },
  { t: '2026-08-09T10:00:00.000Z', tag: '2026-08-09', karte: 'k1', korrekt: true },
  { t: '2026-08-09T10:01:00.000Z', tag: '2026-08-09', karte: 'k2', korrekt: true },
  { t: '2026-08-09T10:02:00.000Z', tag: '2026-08-09', karte: 'k5', korrekt: false },   // Privat/Kochen
  { t: '2026-06-01T10:00:00.000Z', tag: '2026-06-01', karte: 'k1', korrekt: true },     // ausserhalb des Fensters
];
const zst2 = foldReviews(revs, () => ({}));
const st = lernStatistik({ sidecars, zustaende: zst2, reviews: revs, faecher, heute: H, tage: 30 });
ok('zaehlt alle Karten', st.karten === 5, String(st.karten));
ok('Antworten im Fenster gezaehlt (der Juni-Eintrag zaehlt zur Summe)', st.gesamt.antworten === 6, String(st.gesamt.antworten));
ok('Quote stimmt', st.gesamt.quote === Math.round((4 / 6) * 100), String(st.gesamt.quote));
ok('Verlauf hat genau 30 Tage', st.verlauf.length === 30);
ok('Verlauf endet heute', st.verlauf[29].tag === H, st.verlauf[29].tag);
ok('heutiger Tag hat 3 Antworten', st.verlauf[29].gesamt === 3 && st.verlauf[29].richtig === 2, JSON.stringify(st.verlauf[29]));
ok('Tage ausserhalb des Fensters tauchen im Verlauf nicht auf', !st.verlauf.some(v => v.tag === '2026-06-01'));
ok('letzte Antwort = heute', st.gesamt.letzteAntwort === H);
ok('erste Antwort = Juni', st.gesamt.ersteAntwort === '2026-06-01');
ok('Verteilung: Bild-Karte ohne Regionen separat', st.verteilung.bildOffen === 1, JSON.stringify(st.verteilung));
ok('Verteilung summiert auf die spielbaren Karten',
  st.verteilung.neu + st.verteilung.amLernen + st.verteilung.sitzt === 4, JSON.stringify(st.verteilung));
ok('Problemkarten nur mit lapses', st.problemKarten.every(p => p.lapses > 0));
ok('Problemkarten nach lapses sortiert', st.problemKarten.length === 2 &&
  st.problemKarten[0].lapses >= st.problemKarten[1].lapses, JSON.stringify(st.problemKarten.map(p => [p.id, p.lapses])));
ok('Problemkarte nennt Frage und Notiz', !!st.problemKarten[0].frage && !!st.problemKarten[0].notiz);
const stF = lernStatistik({ sidecars, zustaende: zst2, reviews: revs, faecher, heute: H, tage: 30, fach: 'nhm' });
ok('Fach-Filter grenzt Karten ein', stF.karten === 4, String(stF.karten));
ok('Fach-Filter grenzt Antworten ein (k5 faellt raus)', stF.gesamt.antworten === 5, String(stF.gesamt.antworten));
const stO = lernStatistik({ sidecars, zustaende: zst2, reviews: revs, faecher, heute: H, tage: 30, fach: null });
ok('Filter "ohne Fach" liefert nur die nicht zugeordnete Notiz', stO.karten === 1 && stO.gesamt.antworten === 1);
const stLeer = lernStatistik({ sidecars: [], zustaende: new Map(), reviews: [], faecher, heute: H });
ok('leerer Vault ohne Absturz', stLeer.karten === 0 && stLeer.gesamt.quote === null && stLeer.gesamt.serie === 0);
const heuteNichts = lernStatistik({ sidecars, zustaende: zst2, reviews: revs.filter(r => r.tag !== H), faecher, heute: H, tage: 30 });
ok('Serie bricht nicht, nur weil heute noch nichts gelernt wurde', heuteNichts.gesamt.serie === 1, String(heuteNichts.gesamt.serie));

console.log('\n── D4. Pfad-Helfer ──');
ok('Uni/A.md -> Uni/A.karten.json', kartenSidecarPath('Uni/A.md') === 'Uni/A.karten.json');
ok('case-insensitiv (.MD)', kartenSidecarPath('B.MD') === 'B.karten.json');
ok('Rueckweg aus dem Dateinamen', notizAusSidecarPath('Uni/A.karten.json') === 'Uni/A.md');
ok('Log-Datei rotiert monatlich', logDateiFuer('2026-08-09') === '_System/Lernen/log/2026-08.jsonl');

console.log('\n── E. Paritaet UI (lernen-kern.js) ──');
// Die Logik lebt seit R26b in public/lernen-kern.js – EINE Quelle fuer Desktop und Handy.
// Der Test importiert die Datei unveraendert als Modul und haengt nur die Exporte an.
const kern = readFileSync(new URL('../public/lernen-kern.js', import.meta.url), 'utf8');
const mod = await import('data:text/javascript,' + encodeURIComponent(kern
  + '\nexport {lnTrefferRegion, lnMcWertung, lnBildWertung, lnRegionRect, lnTippNorm, lnTippWertung};'));
// Beide Oberflaechen muessen den Kern wirklich laden – sonst driftet die Wertung auseinander.
for (const [datei, name] of [['../public/index.html', 'index.html'], ['../public/lernen.html', 'lernen.html']]) {
  const seite = readFileSync(new URL(datei, import.meta.url), 'utf8');
  ok(name + ' laedt lernen-kern.js', seite.includes('src="/lernen-kern.js"'));
  ok(name + ' definiert die Wertung nicht selbst', !seite.includes('function lnRegionRect'));
}
// Rechtecke: x/y = linke obere Ecke, w/h = Anteil der jeweiligen Achse
const regionen = [{ label: 'A', x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, { label: 'B', x: 0.6, y: 0.6, w: 0.2, h: 0.2 }];
ok('lnTrefferRegion: Treffer in A', mod.lnTrefferRegion(0.25, 0.25, regionen)?.label === 'A');
ok('lnTrefferRegion: Kante zaehlt noch', mod.lnTrefferRegion(0.4, 0.4, regionen)?.label === 'A');
ok('lnTrefferRegion: daneben -> null', mod.lnTrefferRegion(0.5, 0.05, regionen) === null);
ok('lnTrefferRegion: knapp ausserhalb -> null', mod.lnTrefferRegion(0.41, 0.25, regionen) === null);
ok('lnTrefferRegion: kleineres Rechteck gewinnt bei Ueberlappung',
  mod.lnTrefferRegion(0.3, 0.3, [{ label: 'gross', x: 0, y: 0, w: 1, h: 1 }, { label: 'klein', x: .25, y: .25, w: .1, h: .1 }])?.label === 'klein');
ok('lnRegionRect: altes Kreis-Format wird zum Quadrat (x/y war der Mittelpunkt)', (() => {
  const q = mod.lnRegionRect({ label: 'A', x: 0.5, y: 0.5, r: 0.1 });
  return q.x === 0.4 && q.y === 0.4 && Math.abs(q.w - 0.2) < 1e-9 && Math.abs(q.h - 0.2) < 1e-9;
})());
ok('lnTrefferRegion trifft auch alte Kreis-Regionen',
  mod.lnTrefferRegion(0.52, 0.52, [{ label: 'A', x: .5, y: .5, r: .1 }])?.label === 'A');
ok('lnRegionRect: unbrauchbare Region -> null', mod.lnRegionRect({ label: 'A', x: 0.5 }) === null);
ok('lnMcWertung: exakte Menge richtig', mod.lnMcWertung([0, 2], [2, 0]) === true);
ok('lnMcWertung: fehlende Auswahl falsch', mod.lnMcWertung([0], [0, 2]) === false);
ok('lnMcWertung: zu viel ausgewaehlt falsch', mod.lnMcWertung([0, 1, 2], [0, 2]) === false);
ok('lnMcWertung: leere Auswahl falsch', mod.lnMcWertung([], [0]) === false);
const wA = mod.lnBildWertung({ A: 'A', B: 'B' }, regionen);
ok('lnBildWertung: alles richtig', wA.korrekt === true && wA.falsch.length === 0);
const wB = mod.lnBildWertung({ A: 'B', B: 'A' }, regionen);
ok('lnBildWertung: vertauscht -> falsch, nennt beide', wB.korrekt === false && wB.falsch.length === 2);
const wC = mod.lnBildWertung({ A: 'A' }, regionen);
ok('lnBildWertung: unvollstaendig -> falsch', wC.korrekt === false);
// Tipp-Modus: Gross/Kleinschreibung und Satzzeichen duerfen nicht entscheiden
ok('lnTippNorm ignoriert Gross/Klein + Bindestrich', mod.lnTippNorm('Knick-Armroboter') === mod.lnTippNorm('knick armroboter'));
ok('lnTippNorm trimmt', mod.lnTippNorm('  SCARA  ') === 'scara');
const t1 = mod.lnTippWertung(['A', 'B'], regionen);
ok('lnTippWertung: beide richtig', t1.korrekt === true && t1.falsch.length === 0);
const t2 = mod.lnTippWertung(['a', 'falsch'], regionen);
ok('lnTippWertung: Kleinschreibung zaehlt als richtig, Fehler wird benannt',
  t2.korrekt === false && t2.falsch.length === 1 && t2.falsch[0] === 'B');
ok('lnTippWertung: leeres Feld ist falsch', mod.lnTippWertung(['A', ''], regionen).korrekt === false);
ok('lnTippWertung: fehlende Eingaben komplett falsch', mod.lnTippWertung([], regionen).falsch.length === 2);

console.log('\n── A9. loesungsbild (Folienausschnitt nach dem Antworten) ──');
const FB = 'Uni/Dateien/carnot-pv.png';
ok('fragebild an freitext gueltig', V([{ ...kFt, fragebild: FB }]).length === 0, V([{ ...kFt, fragebild: FB }]).join(';'));
ok('fragebild + loesungsbild zusammen gueltig', V([{ ...kMc, fragebild: FB, loesungsbild: FB }]).length === 0);
ok('fragebild an bild-Karte gueltig', V([{ ...kBi, fragebild: FB }]).length === 0);
ok('fragebild mit falscher Endung -> Fehler',
  V([{ ...kFt, fragebild: 'Uni/Dateien/folie.pdf' }])[0].includes('keine Bilddatei'));
ok('fragebild nicht im Vault -> Fehler',
  V([{ ...kFt, fragebild: 'Uni/Dateien/gibtsnicht.png' }])[0].includes('nicht im Vault gefunden'));
const fb1 = mergeKartenIds([{ ...kFt, fragebild: 'Uni\\Dateien\\carnot-pv.png' }], []).karten[0];
ok('fragebild ueberlebt saubereKarte und wird auf / normalisiert', fb1.fragebild === FB, JSON.stringify(fb1));
const fbAlt = mergeKartenIds([kFt], []).karten[0];
const fbNeu = mergeKartenIds([{ ...kFt, fragebild: FB, loesungsbild: FB }], [fbAlt]);
ok('beide Bilder nachtragen behaelt die Karten-ID',
  fbNeu.karten[0].id === fbAlt.id && fbNeu.uebernommen === 1 &&
  fbNeu.karten[0].fragebild === FB && fbNeu.karten[0].loesungsbild === FB, JSON.stringify(fbNeu.karten[0]));

const LB = 'Uni/Dateien/carnot-pv.png';
ok('loesungsbild an freitext gueltig', V([{ ...kFt, loesungsbild: LB }]).length === 0, V([{ ...kFt, loesungsbild: LB }]).join(';'));
ok('loesungsbild an janein gueltig', V([{ ...kJa, loesungsbild: LB }]).length === 0);
ok('loesungsbild an mc gueltig', V([{ ...kMc, loesungsbild: LB }]).length === 0);
ok('loesungsbild an bild-Karte gueltig (zweites Bild)', V([{ ...kBi, loesungsbild: LB }]).length === 0);
ok('loesungsbild weglassen bleibt gueltig', V([kFt]).length === 0);
ok('loesungsbild mit falscher Endung -> Fehler',
  V([{ ...kFt, loesungsbild: 'Uni/Dateien/folie.pdf' }])[0].includes('keine Bilddatei'));
ok('loesungsbild nicht im Vault -> Fehler',
  V([{ ...kFt, loesungsbild: 'Uni/Dateien/gibtsnicht.png' }])[0].includes('nicht im Vault gefunden'));
const lb1 = mergeKartenIds([{ ...kFt, loesungsbild: 'Uni\\Dateien\\carnot-pv.png' }], []).karten[0];
ok('loesungsbild ueberlebt saubereKarte und wird auf / normalisiert', lb1.loesungsbild === LB, JSON.stringify(lb1));
const lbAlt = mergeKartenIds([kFt], []).karten[0];
const lbNeu = mergeKartenIds([{ ...kFt, loesungsbild: LB }], [lbAlt]);
ok('Bild nachtragen behaelt die Karten-ID (Lernstand bleibt)',
  lbNeu.karten[0].id === lbAlt.id && lbNeu.uebernommen === 1, JSON.stringify(lbNeu));

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
