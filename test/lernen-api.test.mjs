// test/lernen-api.test.mjs – R26-E2E: startet den echten ui-server in einem Scratch
// (eigener NEXUS_DATA_DIR + eigener Vault, NIE Pauls Daten) und spricht die
// Lernmodus-Routen ueber HTTP an – inkl. Antwort -> Log -> neue Faelligkeit.
//
// Beweist: Routen-Verdrahtung, Faelligkeits-Berechnung ueber echte Dateien,
// Sidecar-Ausblendung im Dateibaum, Editor-Speichern durch dieselbe Validierung.
// Lauf: node test/lernen-api.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const UI_SERVER = join(__dir, '..', 'src', 'ui-server.js');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra ? `\n     Kontext: ${String(extra).slice(0, 400)}` : ''); fail++; }
}

const PORT = 3987;
const scratch = mkdtempSync(join(tmpdir(), 'nexus lern test-'));
const vaultDir = join(scratch, 'test vault');
mkdirSync(join(vaultDir, 'Uni', 'NHM'), { recursive: true });
mkdirSync(join(vaultDir, 'Uni', 'Bilder'), { recursive: true });
writeFileSync(join(vaultDir, 'Uni', 'NHM', 'VL 01.md'),
  '---\ntitle: VL 01\n---\n# Vorlesung 1\nWertschoepfung = Produktionswert minus Vorleistungen.\nInterne Stakeholder: Mitarbeiter, Eigentuemer.\n', 'utf8');
writeFileSync(join(vaultDir, 'Uni', 'NHM', 'VL 02.md'),
  '# Vorlesung 2\nDie EU-Taxonomie ist verpflichtend.\n', 'utf8');
writeFileSync(join(vaultDir, 'Uni', 'Bilder', 'karte.png'), 'FAKE-PNG');
writeFileSync(join(scratch, 'nexus.config.json'), JSON.stringify({
  vaultsRoot: scratch,
  activeVault: 'testvault',
  vaults: [{ name: 'testvault', path: vaultDir, dbPath: '.nexus/testvault.db' }],
  ui: { port: PORT, autoOpen: false },
  ignore: ['.obsidian', '.trash', '.nexus', 'node_modules'],
}, null, 2), 'utf8');

const base = `http://127.0.0.1:${PORT}`;
const V = 'testvault';
const get  = async (p) => (await fetch(base + p)).json();
// Roh-Antwort inkl. Headern – fuer den Anki-Export (Textdatei, kein JSON)
const getRaw = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body: await r.text() };
};
const post = async (p, body) => {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const heute = (() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })();
const tagPlus = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const srv = spawn(process.execPath, [UI_SERVER], {
  env: { ...process.env, NEXUS_DATA_DIR: scratch, NEXUS_PORT: String(PORT), NEXUS_DEV: '', NEXUS_SHELL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
srv.stdout.on('data', d => { serverLog += d; });
srv.stderr.on('data', d => { serverLog += d; });

async function warten() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + '/api/vaults'); if (r.ok) return true; } catch { /* noch nicht da */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

let exitCode = 1;
try {
  ok('ui-server startet', await warten(), serverLog.slice(-400));

  // Containment-Invariante wie im MCP-Test: nie an Pauls echten Vaults arbeiten.
  const vaults = await get('/api/vaults');
  ok('nur der Scratch-Vault ist registriert', Array.isArray(vaults) && vaults.length === 1 && vaults[0].name === V, JSON.stringify(vaults));

  console.log('\n── 1. Leerer Zustand ──');
  const leer = await get(`/api/lernen/uebersicht?vault=${V}`);
  ok('Uebersicht ohne Karten liefert Nullen', leer.gesamt.karten === 0 && leer.faellige.length === 0, JSON.stringify(leer.gesamt));
  ok('heute ist der lokale Kalendertag', leer.heute === heute, `${leer.heute} vs ${heute}`);
  ok('Verfahren wird benannt', leer.verfahren === 'stufen-v1', leer.verfahren);
  ok('Leiter-Tage werden mitgeliefert', JSON.stringify(leer.stufenTage) === '[1,3,5,7]', JSON.stringify(leer.stufenTage));
  ok('Kalender der naechsten 5 Tage liegt bei', Array.isArray(leer.kalender) && leer.kalender.length === 5 &&
    leer.kalender[0].tag === heute, JSON.stringify(leer.kalender));

  console.log('\n── 2. Karten anlegen (Editor-Route = MCP-Pfad) ──');
  const save1 = await post('/api/karten/save', {
    vault: V, path: 'Uni/NHM/VL 01.md', titel: 'Karten VL 01',
    karten: [
      { typ: 'janein', frage: 'Sind Mitarbeiter interne Stakeholder?', antwort: true, quelle: 'Interne Stakeholder: Mitarbeiter' },
      { typ: 'freitext', frage: 'Definiere Wertschoepfung.', antwort: 'Produktionswert minus Vorleistungen.', quelle: 'Wertschoepfung = Produktionswert minus Vorleistungen' },
      { typ: 'bild', frage: 'Ordne zu.', bild: 'Uni/Bilder/karte.png', labels: ['A', 'B'] },
    ],
  });
  ok('speichern ok', save1.json.ok === true, JSON.stringify(save1.json).slice(0, 300));
  ok('Sidecar liegt neben der Notiz', existsSync(join(vaultDir, 'Uni', 'NHM', 'VL 01.karten.json')));
  ok('Bild-Karte ohne Regionen wird gemeldet', save1.json.bildOhneRegionen?.length === 1);

  const kaputt = await post('/api/karten/save', {
    vault: V, path: 'Uni/NHM/VL 01.md',
    karten: [{ typ: 'janein', frage: 'X?', antwort: true, quelle: 'STEHT NICHT IN DER NOTIZ' }],
  });
  ok('falsche quelle -> HTTP 400 mit Fehlerliste', kaputt.status === 400 && kaputt.json.error.includes('Karte 1'), JSON.stringify(kaputt.json));
  const altSidecar = JSON.parse(readFileSync(join(vaultDir, 'Uni', 'NHM', 'VL 01.karten.json'), 'utf8'));
  ok('… und der bestehende Sidecar bleibt unangetastet', altSidecar.karten.length === 3);

  console.log('\n── 3. Sidecar ist im Dateibaum unsichtbar ──');
  const tree = await get(`/api/tree?vault=${V}`);
  const flach = JSON.stringify(tree);
  ok('*.karten.json taucht nicht im Baum auf', !flach.includes('.karten.json'), flach.slice(0, 300));
  ok('die Notiz selbst schon', flach.includes('VL 01.md'));

  console.log('\n── 4. Uebersicht: notizweise Faelligkeit ──');
  const u1 = await get(`/api/lernen/uebersicht?vault=${V}`);
  ok('3 Karten gesamt, 2 neu (Bild-Karte wartet auf Regionen)',
    u1.gesamt.karten === 3 && u1.gesamt.neu === 2 && u1.gesamt.bildOffen === 1, JSON.stringify(u1.gesamt));
  ok('genau eine Notiz ist faellig', u1.faellige.length === 1 && u1.faellige[0].notiz === 'Uni/NHM/VL 01.md', JSON.stringify(u1.faellige));
  ok('Notiz-Titel kommt aus dem Kartenset', u1.faellige[0].titel === 'Karten VL 01', u1.faellige[0].titel);
  ok('ohne Fach -> Sammeleintrag', u1.faecher.length === 1 && u1.faecher[0].id === null);

  console.log('\n── 5. Faecher + Pruefungstermin ──');
  const fBad = await post('/api/lernen/faecher', { vault: V, faecher: [{ id: 'nhm', name: 'NHM', ordner: ['Gibt/Es/Nicht'] }] });
  ok('nicht existierender Ordner -> 400', fBad.status === 400 && fBad.json.error.includes('existiert nicht'), JSON.stringify(fBad.json));
  const fDatum = await post('/api/lernen/faecher', { vault: V, faecher: [{ id: 'nhm', name: 'NHM', ordner: ['Uni/NHM'], pruefung: '21.08.2026' }] });
  ok('kaputtes Datum -> 400', fDatum.status === 400 && fDatum.json.error.includes('JJJJ-MM-TT'), JSON.stringify(fDatum.json));
  const pruefung = tagPlus(heute, 12);
  const fOk = await post('/api/lernen/faecher', {
    vault: V, faecher: [{ id: 'nhm', name: 'NHM', farbe: '#7ec8a0', ordner: ['Uni/NHM'], pruefung, zielKorrekt: 3, neueProTag: 20 }],
  });
  ok('Fach speichern ok', fOk.json.ok === true, JSON.stringify(fOk.json));
  ok('faecher.json liegt im Vault', existsSync(join(vaultDir, '_System', 'Lernen', 'faecher.json')));
  const u2 = await get(`/api/lernen/uebersicht?vault=${V}`);
  const nhm = u2.faecher.find(f => f.id === 'nhm');
  ok('Karten sind dem Fach zugeordnet', nhm && nhm.karten === 3, JSON.stringify(u2.faecher.map(f => [f.id, f.karten])));
  ok('Resttage bis zur Pruefung', nhm.resttage === 12 && nhm.pruefung === pruefung, JSON.stringify({ r: nhm.resttage, p: nhm.pruefung }));
  ok('Pensum-Prognose vorhanden', typeof nhm.proTagNoetig === 'number' && typeof nhm.aufKurs === 'boolean', JSON.stringify({ p: nhm.proTagNoetig, k: nhm.aufKurs }));

  console.log('\n── 6. Sitzung + Antwort + neue Faelligkeit ──');
  const s1 = await get(`/api/lernen/session?vault=${V}`);
  ok('Queue enthaelt die 2 spielbaren Karten', s1.karten.length === 2 && s1.neu === 2, JSON.stringify(s1.karten.map(k => k.karte.typ)));
  ok('Bild-Karte ohne Regionen wird uebersprungen + gezaehlt', s1.uebersprungenBild === 1 && !s1.karten.some(k => k.karte.typ === 'bild'));
  ok('Queue liefert die vollen Karteninhalte', !!s1.karten[0].karte.frage && !!s1.karten[0].karte.id);
  const sNotiz = await get(`/api/lernen/session?vault=${V}&note=${encodeURIComponent('Uni/NHM/VL 02.md')}`);
  ok('Filter auf eine Notiz ohne Karten -> leer', sNotiz.karten.length === 0);
  const sFach = await get(`/api/lernen/session?vault=${V}&fach=nhm`);
  ok('Filter auf Fach', sFach.karten.length === 2);

  const kId = s1.karten[0].karte.id;
  const a1 = await post('/api/lernen/antwort', { vault: V, notiz: 'Uni/NHM/VL 01.md', kartenId: kId, korrekt: true, dauerMs: 3200, session: 's-test' });
  ok('Antwort ok', a1.json.ok === true, JSON.stringify(a1.json));
  ok('Zustand kommt zurueck (auf Anhieb richtig -> Stufe 1, morgen faellig)',
    a1.json.zustand?.stufe === 1 && a1.json.zustand?.due === tagPlus(heute, 1), JSON.stringify(a1.json.zustand));
  ok('Log-Datei im Vault angelegt', existsSync(join(vaultDir, '_System', 'Lernen', 'log', heute.slice(0, 7) + '.jsonl')));
  const logZeile = JSON.parse(readFileSync(join(vaultDir, '_System', 'Lernen', 'log', heute.slice(0, 7) + '.jsonl'), 'utf8').trim().split('\n')[0]);
  ok('Log-Zeile enthaelt Karte, Tag und Notiz', logZeile.karte === kId && logZeile.tag === heute && logZeile.notiz === 'Uni/NHM/VL 01.md', JSON.stringify(logZeile));
  ok('offene Restmenge wird gemeldet', a1.json.offen === 1, String(a1.json.offen));

  const s2 = await get(`/api/lernen/session?vault=${V}`);
  ok('beantwortete Karte ist heute nicht mehr faellig', !s2.karten.some(k => k.karte.id === kId), JSON.stringify(s2.karten.map(k => k.karte.id)));
  const a2 = await post('/api/lernen/antwort', { vault: V, kartenId: kId, korrekt: false });
  ok('Falschantwort macht sofort wieder faellig', a2.json.zustand?.due === heute && a2.json.zustand?.lapses === 1, JSON.stringify(a2.json.zustand));
  const s3 = await get(`/api/lernen/session?vault=${V}`);
  ok('… und die Karte steht wieder in der Queue', s3.karten.some(k => k.karte.id === kId));
  ok('Validierung: fehlende kartenId -> 400', (await post('/api/lernen/antwort', { vault: V, korrekt: true })).status === 400);
  ok('Validierung: korrekt kein Boolean -> 400', (await post('/api/lernen/antwort', { vault: V, kartenId: kId, korrekt: 'ja' })).status === 400);

  console.log('\n── 7. Editor-Route /api/karten ──');
  const ed = await get(`/api/karten?vault=${V}&path=${encodeURIComponent('Uni/NHM/VL 01.md')}`);
  ok('liefert alle Karten mit Lernstand', ed.karten.length === 3 && ed.karten.find(k => k.id === kId).zustand?.lapses === 1, JSON.stringify(ed.karten.map(k => k.id)));
  ok('spielbar-Flag je Karte', ed.karten.filter(k => k.spielbar).length === 2);
  ok('nicht veraltet direkt nach dem Schreiben', ed.stale === false);
  writeFileSync(join(vaultDir, 'Uni', 'NHM', 'VL 01.md'),
    readFileSync(join(vaultDir, 'Uni', 'NHM', 'VL 01.md'), 'utf8') + '\nNachtrag.\n', 'utf8');
  ok('nach Notiz-Aenderung -> stale', (await get(`/api/karten?vault=${V}&path=${encodeURIComponent('Uni/NHM/VL 01.md')}`)).stale === true);
  ok('Nicht-.md -> 400', (await fetch(`${base}/api/karten?vault=${V}&path=x.txt`)).status === 400);
  ok('fehlende Notiz -> 404', (await fetch(`${base}/api/karten?vault=${V}&path=Gibts/Nicht.md`)).status === 404);

  console.log('\n── 8. Lernstand ueberlebt Regeneration + Umbenennen ──');
  const save2 = await post('/api/karten/save', {
    vault: V, path: 'Uni/NHM/VL 01.md', titel: 'Karten VL 01',
    karten: [
      { typ: 'janein', frage: 'Sind **Mitarbeiter** interne Stakeholder?', antwort: true, quelle: 'Interne Stakeholder: Mitarbeiter' },
      { typ: 'mc', frage: 'Was ist Wertschoepfung?', optionen: ['Produktionswert minus Vorleistungen', 'Umsatz'], korrekt: [0], quelle: 'Wertschoepfung = Produktionswert minus Vorleistungen' },
    ],
  });
  ok('Regeneration ok, 1 ID uebernommen', save2.json.ok === true && save2.json.uebernommen === 1, JSON.stringify(save2.json));
  const ed2 = await get(`/api/karten?vault=${V}&path=${encodeURIComponent('Uni/NHM/VL 01.md')}`);
  ok('LERNSTAND der uebernommenen Karte ist noch da', ed2.karten.find(k => k.id === kId)?.zustand?.lapses === 1, JSON.stringify(ed2.karten.map(k => [k.id, k.zustand?.lapses])));

  // ── Uebungsmodus: alles abfragbar, Lernstand bleibt unberuehrt ──
  const vorUebung = await get(`/api/lernen/uebersicht?vault=${V}`);
  const ueb1 = await get(`/api/lernen/session?vault=${V}&uebung=1&limit=60`);
  ok('Uebung meldet sich als Uebung', ueb1.uebung === true, JSON.stringify({ u: ueb1.uebung }));
  ok('Uebung liefert auch nicht faellige Karten', ueb1.gesamt >= vorUebung.gesamt.faellig + vorUebung.gesamt.neu,
    `${ueb1.gesamt} vs faellig ${vorUebung.gesamt.faellig} + neu ${vorUebung.gesamt.neu}`);
  const logVorUebung = existsSync(join(vaultDir, '_System', 'Lernen', 'log'))
    ? readdirSync(join(vaultDir, '_System', 'Lernen', 'log')).map(f => readFileSync(join(vaultDir, '_System', 'Lernen', 'log', f), 'utf8')).join('').length
    : 0;
  const nachUebung = await get(`/api/lernen/uebersicht?vault=${V}`);
  ok('Uebung aendert die Faelligkeiten nicht', JSON.stringify(nachUebung.gesamt) === JSON.stringify(vorUebung.gesamt),
    JSON.stringify({ vor: vorUebung.gesamt, nach: nachUebung.gesamt }));
  const logNachUebung = existsSync(join(vaultDir, '_System', 'Lernen', 'log'))
    ? readdirSync(join(vaultDir, '_System', 'Lernen', 'log')).map(f => readFileSync(join(vaultDir, '_System', 'Lernen', 'log', f), 'utf8')).join('').length
    : 0;
  ok('Uebung schreibt nichts in den Log', logVorUebung === logNachUebung, `${logVorUebung} -> ${logNachUebung}`);
  // Themenblock-Auswahl
  const nurEine = await get(`/api/lernen/session?vault=${V}&uebung=1&notes=${encodeURIComponent('Uni/NHM/VL 01.md')}`);
  ok('Themenblock-Filter greift', nurEine.karten.every(e => e.notiz === 'Uni/NHM/VL 01.md') && nurEine.gesamt > 0,
    JSON.stringify(nurEine.karten.map(e => e.notiz)));

  // ── Storno: verklickte Antwort zuruecknehmen (append-only, nichts wird geloescht) ──
  const vorStorno = await get(`/api/karten?vault=${V}&path=${encodeURIComponent('Uni/NHM/VL 01.md')}`);
  const zVor = vorStorno.karten.find(k => k.id === kId)?.zustand;
  const falschAntwort = await post('/api/lernen/antwort', { vault: V, kartenId: kId, korrekt: false, notiz: 'Uni/NHM/VL 01.md' });
  ok('Antwort liefert ihren Zeitstempel zurueck', typeof falschAntwort.json.t === 'string' && falschAntwort.json.t.length > 10, JSON.stringify(falschAntwort.json));
  const zNachFalsch = falschAntwort.json.zustand;
  ok('Fehlversuch erhoeht lapses', zNachFalsch.lapses === (zVor?.lapses ?? 0) + 1, `${zVor?.lapses} -> ${zNachFalsch.lapses}`);
  const undo = await post('/api/lernen/undo', { vault: V, kartenId: kId, t: falschAntwort.json.t });
  ok('Storno wird angenommen', undo.json.ok === true, JSON.stringify(undo.json));
  ok('Storno macht den Fehlversuch rueckgaengig', undo.json.zustand.lapses === (zVor?.lapses ?? 0),
    `erwartet ${zVor?.lapses}, ist ${undo.json.zustand.lapses}`);
  const logDir = join(vaultDir, '_System', 'Lernen', 'log');
  const logInhalt = existsSync(logDir)
    ? readdirSync(logDir).filter(f => f.endsWith('.jsonl')).map(f => readFileSync(join(logDir, f), 'utf8')).join('')
    : '';
  ok('die stornierte Zeile steht noch im Log (nichts wird geloescht)', logInhalt.includes(falschAntwort.json.t));
  ok('… und eine Storno-Zeile verweist darauf', logInhalt.includes('"storniert":"' + falschAntwort.json.t + '"'));
  const undoMist = await post('/api/lernen/undo', { vault: V, kartenId: kId, t: 'kein-datum' });
  ok('Storno mit unbrauchbarem Zeitstempel wird abgelehnt', undoMist.status === 400, String(undoMist.status));

  // ── Anki-Export ──
  const anki = await getRaw(`/api/lernen/anki?vault=${V}`);
  ok('Anki-Export liefert eine Textdatei zum Download', anki.status === 200 &&
    /attachment; filename=/.test(anki.headers['content-disposition'] || ''), anki.headers['content-disposition']);
  ok('Anki-Export beginnt mit den Import-Kopfzeilen', anki.body.startsWith('#separator:tab'), anki.body.slice(0, 40));
  ok('Anki-Export enthaelt eine Zeile je Karte', anki.body.trim().split('\n').length === 3 + Number(anki.headers['x-nexus-karten']),
    `${anki.body.trim().split('\n').length} Zeilen, Header sagt ${anki.headers['x-nexus-karten']}`);

  // ── Statistik ──
  const stat = await get(`/api/lernen/statistik?vault=${V}&tage=30`);
  ok('Statistik liefert einen 30-Tage-Verlauf', Array.isArray(stat.verlauf) && stat.verlauf.length === 30);
  ok('Statistik zaehlt die stornierte Antwort nicht mit', stat.gesamt.antworten === 2, JSON.stringify(stat.gesamt));

  const mv = await post('/api/rename', { vault: V, oldPath: 'Uni/NHM/VL 01.md', newPath: 'Uni/NHM/VL 01 – neu.md' });
  ok('Umbenennen ok', mv.json.ok === true, JSON.stringify(mv.json));
  ok('Karten-Sidecar zieht mit', existsSync(join(vaultDir, 'Uni', 'NHM', 'VL 01 – neu.karten.json')) &&
    !existsSync(join(vaultDir, 'Uni', 'NHM', 'VL 01.karten.json')));
  const u3 = await get(`/api/lernen/uebersicht?vault=${V}`);
  ok('Uebersicht folgt dem neuen Pfad', u3.notizen.some(n => n.notiz === 'Uni/NHM/VL 01 – neu.md'), JSON.stringify(u3.notizen.map(n => n.notiz)));
  ok('Lernstand haengt an der ID, nicht am Pfad', u3.gesamt.antworten === 2, JSON.stringify(u3.gesamt));

  const del = await post('/api/delete', { vault: V, path: 'Uni/NHM/VL 01 – neu.md' });
  ok('Loeschen ok', del.json.ok === true);
  ok('Karten-Sidecar mit geloescht', !existsSync(join(vaultDir, 'Uni', 'NHM', 'VL 01 – neu.karten.json')));

  exitCode = fail ? 1 : 0;
} catch (e) {
  console.log('  \x1b[31m✗\x1b[0m Ausnahme:', e.message);
  console.log(serverLog.slice(-800));
  fail++;
} finally {
  srv.kill();
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 }); } catch { /* Windows-Locks */ }
}

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
