// test/mcp-http-write.test.mjs – R31: Remote-Connector schreibend (Stufen, Regeln).
//
//   1. Konfiguration der Stufen (NEXUS_MCP_LEVELS) – Standard bleibt nur lesen
//   2. Stufe "write": Schreib-Tools sichtbar und wirksam, nur im freigegebenen Vault
//   3. Regeln je Aufruf: kein endgueltiges Loeschen, _System geschuetzt, vault_check als Trockenlauf
//   4. Stufe "admin": delete landet im Papierkorb, reindex, vault_check mit Bericht
//   5. Audit-Log: Pflicht bei Schreibstufen, eine Zeile je aenderndem Aufruf, fail-closed
//   6. Download-Links: datei_link + GET /dl/<token>/<name>, Signatur, Ablauf, Grenzen
// Aufbau: test/mcp-http-helfer.mjs. Lauf: node test/mcp-http-write.test.mjs
import { existsSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { aufbau } from './mcp-http-helfer.mjs';
import { loadHttpConfig } from '../src/mcp/http-config.js';
import { REMOTE_READ_TOOLS, REMOTE_WRITE_TOOLS, REMOTE_ADMIN_TOOLS, remotePolicy, remoteGuard } from '../src/mcp/remote-policy.js';
import { makeDownloads, contentDisposition } from '../src/mcp/download.js';

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? `\n     Kontext: ${String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 500)}` : ''); fail++; }
}
const wirft = (env) => { try { loadHttpConfig(env); return null; } catch (e) { return e.message; } };
const sortiert = (l) => [...l].sort().join();

const t = await aufbau('nexus-mcp-write-');
const { ENV, vaultPfad } = t;
const platte = (...rel) => readFileSync(vaultPfad('wissen', ...rel), 'utf8');
// Umgebung fuer einen Server mit Schreibstufen.
const AUDIT = join(t.scratch, 'audit', 'audit.jsonl');
const schreibEnv = (levels, extra = {}) => ({ ...ENV, NEXUS_MCP_LEVELS: levels, NEXUS_MCP_AUDIT_LOG: AUDIT, ...extra });
const auditZeilen = (datei = AUDIT) => existsSync(datei) ? readFileSync(datei, 'utf8').split('\n').filter(Boolean).map(z => JSON.parse(z)) : [];

try {
  // ── 1. Konfiguration ───────────────────────────────────────────────────────
  console.log('1. Stufen-Konfiguration');
  {
    ok('Standard: nur "read"', loadHttpConfig(ENV).levels.join() === 'read');
    ok('"write" einschalten', loadHttpConfig(schreibEnv('write')).levels.join() === 'read,write');
    ok('"admin" zusaetzlich zu "write", Reihenfolge und Gross/Klein egal', loadHttpConfig(schreibEnv(' Admin , WRITE')).levels.join() === 'read,write,admin'
      && loadHttpConfig(schreibEnv('read,write,admin')).levels.join() === 'read,write,admin');
    ok('"admin" ohne "write" -> Konfigurationsfehler', /admin setzt write voraus/.test(wirft(schreibEnv('admin')) ?? '') && /admin setzt write voraus/.test(wirft(schreibEnv('read, ADMIN')) ?? ''));
    ok('"read" laesst sich nicht abwaehlen', loadHttpConfig(schreibEnv('write')).levels.includes('read'));
    ok('unbekannte Stufe -> Konfigurationsfehler', /NEXUS_MCP_LEVELS/.test(wirft(schreibEnv('write,root')) ?? ''));
    ok('Tool-Listen der Stufen ueberschneiden sich nicht', new Set([...REMOTE_READ_TOOLS, ...REMOTE_WRITE_TOOLS, ...REMOTE_ADMIN_TOOLS]).size
      === REMOTE_READ_TOOLS.length + REMOTE_WRITE_TOOLS.length + REMOTE_ADMIN_TOOLS.length);
    ok('remotePolicy ohne Stufen = nur Lese-Tools', sortiert(remotePolicy().tools) === sortiert(REMOTE_READ_TOOLS));
    ok('ein Lese-Tool ohne readOnlyHint wird nie freigegeben', remotePolicy({ levels: ['write', 'admin'] }).allow('search', { annotations: { readOnlyHint: false } }) === false);

    const nurLesen = await t.starte(t.baueApp(loadHttpConfig(ENV)));
    ok('ohne NEXUS_MCP_LEVELS: tools/list zeigt genau die Lese-Tools', sortiert(await t.toolNamen(nurLesen)) === sortiert(REMOTE_READ_TOOLS));
    const r = await t.rufer(nurLesen)('write_note', { path: 'Neu.md', content: 'x', create: true });
    ok('ohne NEXUS_MCP_LEVELS: write_note abgelehnt, nichts angelegt', r.fehler && !existsSync(vaultPfad('wissen', 'Neu.md')), r.text);
  }

  // ── 2. Stufe write ─────────────────────────────────────────────────────────
  console.log('2. Stufe write');
  {
    const port = await t.starte(t.baueApp(loadHttpConfig(schreibEnv('write'))));
    const ruf = t.rufer(port);
    const namen = await t.toolNamen(port);
    ok('tools/list: Lese- und Schreib-Tools, keine Admin-Tools', sortiert(namen) === sortiert([...REMOTE_READ_TOOLS, ...REMOTE_WRITE_TOOLS]), namen.join());
    ok('delete und reindex sind nicht sichtbar', !namen.includes('delete') && !namen.includes('reindex'));
    const init = await t.anfrage(port, { token: t.GUT, body: t.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '0' } }) });
    const hinweise = init.json?.result?.instructions ?? '';
    ok('initialize: Hinweistext nennt die Schreib-Tools und expected_hash, aber kein delete', /write_note/.test(hinweise) && /expected_hash/.test(hinweise) && !/\bdelete\b/.test(hinweise.replace('delete verwenden', '')), hinweise);

    const neu = await ruf('write_note', { path: 'Remote/Neu.md', content: '# Neu\n\nVom Handy.\n', create: true });
    ok('write_note legt eine Notiz an', !neu.fehler && neu.json?.ok === true && platte('Remote', 'Neu.md') === '# Neu\n\nVom Handy.\n', neu.text);
    ok('Ergebnis nennt Vault und Hash', neu.json?.vault === 'wissen' && /^sha256:/.test(neu.json?.hash ?? ''), neu.text);
    const such = await ruf('search', { q: 'Handy' });
    ok('die neue Notiz ist sofort im Index', such.text.includes('Remote/Neu.md'), such.text);
    const an = await ruf('append_to_section', { path: 'Notiz.md', section: 'Abschnitt', text: 'Angehaengt.', expected_hash: (await ruf('outline', { path: 'Notiz.md' })).json?.hash });
    ok('append_to_section mit expected_hash', !an.fehler && platte('Notiz.md').includes('Angehaengt.'), an.text);
    const alt = await ruf('patch', { path: 'Notiz.md', patches: [{ old_str: 'Leuchtturm', new_str: 'X' }], expected_hash: neu.json.hash });
    ok('patch mit fremdem Hash -> Fehler, nichts geaendert', alt.fehler && /Stand abweichend/.test(alt.text) && platte('Notiz.md').includes('Leuchtturm'), alt.text);
    ok('create_folder', !(await ruf('create_folder', { path: 'Remote/Ordner' })).fehler && existsSync(vaultPfad('wissen', 'Remote', 'Ordner')));
    const mv = await ruf('move', { from: 'Remote/Neu.md', to: 'Remote/Ordner/Neu.md' });
    ok('move', !mv.fehler && existsSync(vaultPfad('wissen', 'Remote', 'Ordner', 'Neu.md')) && !existsSync(vaultPfad('wissen', 'Remote', 'Neu.md')), mv.text);

    const cap = await ruf('capture', { text: 'Schnell notiert am Handy', titel: 'Handy-Gedanke' });
    ok('capture legt eine Notiz im Eingangsordner an', !cap.fehler && /^_Eingang\/.+ – Handy-Gedanke\.md$/.test(cap.json?.path ?? '') && existsSync(vaultPfad('wissen', cap.json.path)), cap.text);

    const fremd = await ruf('write_note', { path: 'Neu.md', content: 'x', create: true, vault: 'privat' });
    ok('Schreiben in einen nicht freigegebenen Vault -> Fehler, nichts angelegt', fremd.fehler && !existsSync(vaultPfad('privat', 'Neu.md')), fremd.text);
    const raus = await ruf('write_note', { path: '../privat/Raus.md', content: 'x', create: true });
    ok('Pfad aus dem Vault heraus -> Fehler, nichts angelegt', raus.fehler && !existsSync(vaultPfad('privat', 'Raus.md')), raus.text);
    for (const n of REMOTE_ADMIN_TOOLS) ok(`${n} ist auf Stufe write nicht aufrufbar`, (await ruf(n, { path: 'Notiz.md' })).fehler);
    ok('Notiz.md liegt nach dem delete-Versuch noch da', existsSync(vaultPfad('wissen', 'Notiz.md')));

    writeFileSync(vaultPfad('wissen', 'Notiz.sync-conflict-20261121-153000-ABCDEFG.md'), '# Notiz\n\nFassung vom anderen Geraet.\n', 'utf8');
    const vc = await ruf('vault_check', {});
    ok('vault_check meldet die Syncthing-Konfliktdatei', vc.json?.summary?.syncConflicts === 1 && vc.json?.samples?.syncConflicts?.[0]?.original === 'Notiz.md', vc.text);
    ok('vault_check ohne Stufe admin: laeuft als Trockenlauf, kein Bericht im Vault', !vc.fehler && vc.json?.dryRun === true && vc.json?.reportPath === null
      && !existsSync(vaultPfad('wissen', '_System', 'Vault-Check.md')), vc.text);
    const vc2 = await ruf('vault_check', { dry_run: false });
    ok('vault_check dry_run:false ohne admin: bleibt Trockenlauf', vc2.json?.dryRun === true && !existsSync(vaultPfad('wissen', '_System', 'Vault-Check.md')), vc2.text);
    const zeile = t.logZeilen.map(z => JSON.parse(z)).filter(z => z.tool === 'move').pop();
    ok('Aufruf-Log nennt bei move die Quelle als Pfad', zeile?.pfad === 'Remote/Neu.md' && zeile?.ergebnis === 'ok', zeile);
  }

  // ── 3. Regeln je Aufruf ────────────────────────────────────────────────────
  console.log('3. Regeln');
  {
    const g = remoteGuard({ levels: ['read', 'write', 'admin'] });
    ok('delete permanent -> abgelehnt (auch fuer Papierkorb-Pfade)', /gesperrt/.test(g('delete', { path: '.trash/2026-01-01_000000/x.md', permanent: true })?.error ?? ''));
    for (const p of ['_System', '_System/Regeln.md', '_system/regeln.md', './_System/Regeln.md', '_System\\Regeln.md', '_System//Regeln.md'])
      ok(`delete ${JSON.stringify(p)} -> abgelehnt`, /_System/.test(g('delete', { path: p })?.error ?? ''));
    ok('delete ausserhalb von _System -> erlaubt', g('delete', { path: 'Uni/_System-Notizen.md' }) === undefined && g('delete', { path: '_Systematik/x.md' }) === undefined);
    ok('move in den Papierkorb -> abgelehnt', /Papierkorb/.test(g('move', { from: 'a.md', to: '.trash/a.md' })?.error ?? '') && /Papierkorb/.test(g('move', { from: 'a.md', to: './.TRASH/x/a.md' })?.error ?? ''));
    ok('move des Ordners _System -> abgelehnt, einer Notiz darin -> erlaubt', /_System/.test(g('move', { from: '_System', to: 'Alt' })?.error ?? '') && g('move', { from: '_System/a.md', to: '_System/b.md' }) === undefined);
    ok('move aus _System heraus -> abgelehnt (erster Schritt zum Loeschen)', /_System/.test(g('move', { from: '_System/a.md', to: 'Alt/a.md' })?.error ?? '') && /_System/.test(g('move', { from: '_system/Templates', to: 'T' })?.error ?? ''));
    ok('move nach _System hinein und ausserhalb davon -> erlaubt', g('move', { from: 'Alt/a.md', to: '_System/a.md' }) === undefined && g('move', { from: 'A/x.md', to: 'B/x.md' }) === undefined);
    for (const p of ['_System.', '_System ', '_SYSTEM./Regeln.md']) ok(`delete ${JSON.stringify(p)} (Windows-Schreibweise) -> abgelehnt`, /_System/.test(g('delete', { path: p })?.error ?? ''));
    for (const [n, a] of [['write_note', { path: '.stignore', content: '*' }], ['write_note', { path: 'Uni/.versteckt/x.md', content: 'x' }], ['patch', { path: '.trash/2026/x.md', patches: [] }],
      ['append_to_section', { path: './.obsidian/app.md', section: 'A', text: 'x' }], ['create_folder', { path: '.git' }], ['write_karten', { path: '.x/N.md', karten: [] }]])
      ok(`${n} auf verstecktem Pfad ${JSON.stringify(a.path)} -> abgelehnt`, /Versteckte Pfade/.test(g(n, a)?.error ?? ''));
    ok('move von/nach versteckten Pfaden -> abgelehnt', /Versteckte Pfade/.test(g('move', { from: '.stignore', to: 'x.md' })?.error ?? '') && /Versteckte Pfade/.test(g('move', { from: 'x.md', to: 'A/.b/x.md' })?.error ?? ''));
    ok('normale Pfade mit Punkt im Namen bleiben schreibbar', g('write_note', { path: 'Uni/v1.2 Notiz.md', content: 'x' }) === undefined && g('write_note', { path: 'a.b/c.md', content: 'x' }) === undefined);
    for (const p of ['.stignore', '.stfolder', './.stignore', 'Uni/.versteckt/x.md', '.trash/2026-01-01_000000/x.md', '.TRASH\\2026-01-01_000000', '.git'])
      ok(`delete auf verstecktem Pfad ${JSON.stringify(p)} -> abgelehnt`, /Versteckte Pfade/.test(g('delete', { path: p })?.error ?? ''));
    ok('delete: normale Pfade mit Punkt im Namen bleiben loeschbar', g('delete', { path: 'Uni/v1.2 Notiz.md' }) === undefined && g('delete', { path: 'a.b/c.md' }) === undefined);
    ok('restore aus dem Papierkorb bleibt erlaubt', g('restore', { path: '.trash/2026-01-01_000000/x.md' }) === undefined
      && g('restore', { path: '.trash/2026-01-01_000000/Uni/v1.2 Notiz.md' }) === undefined && g('restore', { path: 'Uni/x.md' }) === undefined);
    for (const p of ['.trash/2026-01-01_000000/.stignore', '.trash/2026-01-01_000000/Uni/.versteckt/x.md', '.TRASH\\2026-01-01_000000\\.git\\config', '.stignore', 'Uni/.versteckt/x.md', '.trash'])
      ok(`restore mit verstecktem Ziel ${JSON.stringify(p)} -> abgelehnt`, /Versteckte Pfade/.test(g('restore', { path: p })?.error ?? ''));
    ok('vault_check mit admin: unveraendert', g('vault_check', {}) === undefined);
    ok('vault_check ohne admin: dry_run erzwungen', remoteGuard({ levels: ['read', 'write'] })('vault_check', { dry_run: false })?.args?.dry_run === true);
    ok('andere Tools: keine Regel', g('write_note', { path: '_System/Regeln.md', content: 'x' }) === undefined && g('search', { q: 'x' }) === undefined);
  }

  // ── 4. Stufe admin ─────────────────────────────────────────────────────────
  console.log('4. Stufe admin');
  {
    const port = await t.starte(t.baueApp(loadHttpConfig(schreibEnv('write,admin'))));
    const ruf = t.rufer(port);
    ok('tools/list: alle drei Stufen', sortiert(await t.toolNamen(port)) === sortiert([...REMOTE_READ_TOOLS, ...REMOTE_WRITE_TOOLS, ...REMOTE_ADMIN_TOOLS]));
    const weg = await ruf('delete', { path: 'Remote/Ordner/Neu.md' });
    ok('delete verschiebt in den Papierkorb', !weg.fehler && /^\.trash\//.test(weg.json?.trashed ?? '') && !existsSync(vaultPfad('wissen', 'Remote', 'Ordner', 'Neu.md')) && existsSync(vaultPfad('wissen', weg.json.trashed)), weg.text);
    const end = await ruf('delete', { path: weg.json.trashed, permanent: true });
    ok('delete permanent -> Fehler, der Papierkorb-Eintrag bleibt', end.fehler && /gesperrt/.test(end.text) && existsSync(vaultPfad('wissen', weg.json.trashed)), end.text);
    const sys = await ruf('delete', { path: '_System/Regeln.md' });
    ok('delete unter _System -> Fehler, Datei bleibt', sys.fehler && existsSync(vaultPfad('wissen', '_System', 'Regeln.md')), sys.text);
    const st = await ruf('write_note', { path: '.stignore', content: '*', create: true });
    ok('write_note auf .stignore -> Fehler, nichts angelegt', st.fehler && !existsSync(vaultPfad('wissen', '.stignore')), st.text);
    // Steuerdateien der Synchronisation: liegen im Vault, duerfen remote nicht in den Papierkorb.
    writeFileSync(vaultPfad('wissen', '.stignore'), '// Muster\n', 'utf8');
    mkdirSync(vaultPfad('wissen', '.stfolder'), { recursive: true });
    const papierkorbVorher = sortiert(readdirSync(vaultPfad('wissen', '.trash')));
    for (const p of ['.stignore', '.stfolder']) {
      const r = await ruf('delete', { path: p });
      ok(`delete ${p} -> Fehler, bleibt liegen`, r.fehler && /Versteckte Pfade/.test(r.text) && existsSync(vaultPfad('wissen', p)), r.text);
    }
    const imKorb = await ruf('delete', { path: weg.json.trashed });
    ok('delete auf einen Papierkorb-Eintrag (ohne permanent) -> Fehler, Eintrag bleibt', imKorb.fehler && existsSync(vaultPfad('wissen', weg.json.trashed)), imKorb.text);
    ok('im Papierkorb ist dabei nichts dazugekommen', sortiert(readdirSync(vaultPfad('wissen', '.trash'))) === papierkorbVorher);
    mkdirSync(vaultPfad('wissen', '.trash', '2026-01-01_000000', '.stversions'), { recursive: true });
    writeFileSync(vaultPfad('wissen', '.trash', '2026-01-01_000000', '.stversions', 'x.md'), 'alt', 'utf8');
    const rv = await ruf('restore', { path: '.trash/2026-01-01_000000/.stversions/x.md' });
    ok('restore mit verstecktem Ziel -> Fehler, nichts zurueckgeholt', rv.fehler && /Versteckte Pfade/.test(rv.text) && !existsSync(vaultPfad('wissen', '.stversions'))
      && existsSync(vaultPfad('wissen', '.trash', '2026-01-01_000000', '.stversions', 'x.md')), rv.text);
    const hinaus = await ruf('move', { from: '_System/Regeln.md', to: 'Regeln.md' });
    ok('move aus _System heraus -> Fehler, Datei bleibt', hinaus.fehler && existsSync(vaultPfad('wissen', '_System', 'Regeln.md')) && !existsSync(vaultPfad('wissen', 'Regeln.md')), hinaus.text);
    const trick = await ruf('move', { from: '_System/Regeln.md', to: '.trash/Regeln.md' });
    ok('move nach .trash -> Fehler, Datei bleibt', trick.fehler && existsSync(vaultPfad('wissen', '_System', 'Regeln.md')), trick.text);
    const zurueck = await ruf('restore', { path: weg.json.trashed });
    ok('restore holt die Notiz zurueck', !zurueck.fehler && existsSync(vaultPfad('wissen', 'Remote', 'Ordner', 'Neu.md')), zurueck.text);
    ok('reindex', (await ruf('reindex', {})).json?.ok === true);
    const vc = await ruf('vault_check', {});
    ok('vault_check mit admin schreibt den Bericht', !vc.fehler && vc.json?.reportPath === '_System/Vault-Check.md' && existsSync(vaultPfad('wissen', '_System', 'Vault-Check.md')), vc.text);
    ok('im nicht freigegebenen Vault ist nichts entstanden', readdirSync(vaultPfad('privat')).join() === 'Geheim.md', readdirSync(vaultPfad('privat')).join());
  }

  // ── 5. Audit-Log ───────────────────────────────────────────────────────────
  console.log('5. Audit-Log');
  {
    ok('Schreibstufe ohne NEXUS_MCP_AUDIT_LOG -> Konfigurationsfehler', /NEXUS_MCP_AUDIT_LOG fehlt/.test(wirft({ ...ENV, NEXUS_MCP_LEVELS: 'write' }) ?? '')
      && /NEXUS_MCP_AUDIT_LOG fehlt/.test(wirft({ ...ENV, NEXUS_MCP_LEVELS: 'write,admin' }) ?? ''));
    ok('nur lesen braucht kein Audit-Log', loadHttpConfig(ENV).auditLog === null);
    ok('relativer Pfad -> Konfigurationsfehler', /absoluter Pfad/.test(wirft(schreibEnv('write', { NEXUS_MCP_AUDIT_LOG: 'audit.jsonl' })) ?? ''));
    let imVault = null;
    try { t.baueApp(loadHttpConfig(schreibEnv('write', { NEXUS_MCP_AUDIT_LOG: vaultPfad('wissen', 'audit.jsonl') }))); } catch (e) { imVault = e.message; }
    ok('Audit-Log in einem Vault -> die App startet nicht', /ausserhalb der Vaults/.test(imVault ?? ''), imVault);
    let imFremden = null;
    try { t.baueApp(loadHttpConfig(schreibEnv('write', { NEXUS_MCP_AUDIT_LOG: vaultPfad('privat', 'x', 'audit.jsonl') }))); } catch (e) { imFremden = e.message; }
    ok('auch nicht in einem nicht freigegebenen Vault', /ausserhalb der Vaults/.test(imFremden ?? '') && !existsSync(vaultPfad('privat', 'x')), imFremden);

    // Die Abschnitte 2 und 4 haben ueber AUDIT geschrieben.
    const alle = auditZeilen();
    const von = (tool) => alle.filter(z => z.tool === tool);
    ok('jede Zeile hat Zeit, sub, client, tool, ergebnis', alle.length > 0 && alle.every(z => !isNaN(Date.parse(z.zeit)) && z.sub === '00000000-0000-4000-8000-000000000001' && z.client === 'test-client' && z.tool && ['ok', 'fehler'].includes(z.ergebnis)), alle[0]);
    ok('Lese-Tools stehen nicht im Audit-Log', alle.every(z => !REMOTE_READ_TOOLS.includes(z.tool)), alle.map(z => z.tool).join());
    const w = von('write_note').find(z => z.pfad === 'Remote/Neu.md');
    ok('write_note: Vault, Pfad, hashVorher null (neu), hash', w?.ergebnis === 'ok' && w.vault === 'wissen' && w.hashVorher === null && /^sha256:[0-9a-f]{64}$/.test(w.hash ?? ''), w);
    const a = von('append_to_section').find(z => z.ergebnis === 'ok');
    ok('append_to_section: Hash vorher und nachher', /^sha256:/.test(a?.hashVorher ?? '') && /^sha256:/.test(a?.hash ?? '') && a.hashVorher !== a.hash, a);
    const p = von('patch').find(z => z.ergebnis === 'fehler');
    ok('abgelehnter patch (Hash-Fehler): Zeile mit ergebnis "fehler" und Grund', /Stand abweichend/.test(p?.fehler ?? '') && p.pfad === 'Notiz.md', p);
    const m = von('move').find(z => z.ergebnis === 'ok');
    ok('move: Quelle und Ziel', m?.pfad === 'Remote/Neu.md' && m.nach === 'Remote/Ordner/Neu.md', m);
    const d = von('delete');
    ok('delete: Papierkorb-Pfad als Ziel; die abgelehnten Versuche stehen als Fehler drin', d.some(z => z.ergebnis === 'ok' && /^\.trash\//.test(z.nach ?? ''))
      && d.some(z => z.ergebnis === 'fehler' && /gesperrt/.test(z.fehler)) && d.some(z => z.ergebnis === 'fehler' && /_System/.test(z.fehler)), d);
    ok('Schreibversuch in den nicht freigegebenen Vault steht als Fehler drin', von('write_note').some(z => z.ergebnis === 'fehler' && z.vault === 'privat'));
    const cz = von('capture')[0];
    ok('capture: der angelegte Pfad steht im Audit-Log', cz?.ergebnis === 'ok' && /^_Eingang\//.test(cz.pfad ?? '') && cz.hashVorher === null, cz);
    const roh = readFileSync(AUDIT, 'utf8');
    ok('kein Notiztext im Audit-Log', !roh.includes('Vom Handy') && !roh.includes('Schnell notiert') && !roh.includes('Angehaengt') && !roh.includes('Leuchtturm'));
    ok('eine Zeile je Aufruf, jede gueltiges JSON', roh.endsWith('\n') && roh.trim().split('\n').length === alle.length);

    // Fail-closed: Log nicht beschreibbar -> Aenderung abgelehnt, nichts geschrieben; Lesen geht weiter.
    const eigenes = join(t.scratch, 'audit2', 'a.jsonl');
    const port = await t.starte(t.baueApp(loadHttpConfig(schreibEnv('write', { NEXUS_MCP_AUDIT_LOG: eigenes }))));
    const ruf = t.rufer(port);
    ok('Start legt den Ordner des Audit-Logs an', existsSync(eigenes));
    rmSync(join(t.scratch, 'audit2'), { recursive: true, force: true });
    const zu = await ruf('write_note', { path: 'OhneAudit.md', content: 'x', create: true });
    ok('Audit-Log weg -> write_note abgelehnt, nichts angelegt', zu.fehler && /Audit-Log/.test(zu.text) && !existsSync(vaultPfad('wissen', 'OhneAudit.md')), zu.text);
    ok('Lesen geht ohne Audit-Log weiter', !(await ruf('search', { q: 'Leuchtturm' })).fehler);
    mkdirSync(join(t.scratch, 'audit2'), { recursive: true });
    const wieder = await ruf('write_note', { path: 'MitAudit.md', content: 'x', create: true });
    ok('Audit-Log wieder da -> Schreiben geht, Zeile steht drin', !wieder.fehler && auditZeilen(eigenes).some(z => z.tool === 'write_note' && z.pfad === 'MitAudit.md'), wieder.text);
  }

  // ── 6. Download-Links ──────────────────────────────────────────────────────
  console.log('6. Download-Links');
  {
    const GEHEIM = 'test-geheimnis-nur-fuer-diesen-lauf-0123456789';
    const dlEnv = (extra = {}) => ({ ...ENV, NEXUS_MCP_DOWNLOAD_SECRET: GEHEIM, ...extra });
    ok('Standard: Download-Links aus', loadHttpConfig(ENV).download === null);
    ok('zu kurzes Geheimnis -> Konfigurationsfehler', /NEXUS_MCP_DOWNLOAD_SECRET/.test(wirft(dlEnv({ NEXUS_MCP_DOWNLOAD_SECRET: 'kurz' })) ?? ''));
    const cfg = loadHttpConfig(dlEnv());
    ok('Standardwerte: 300 s, 50 MB, Basis = Ursprung der Ressourcen-URL', cfg.download.ttlS === 300 && cfg.download.maxBytes === 50 * 1024 * 1024 && cfg.download.baseUrl === 'https://mcp.example.com', cfg.download);
    ok('TTL ausserhalb 30..3600 -> Konfigurationsfehler', /NEXUS_MCP_DOWNLOAD_TTL_S/.test(wirft(dlEnv({ NEXUS_MCP_DOWNLOAD_TTL_S: '5' })) ?? ''));
    const andere = loadHttpConfig(dlEnv({ NEXUS_MCP_DOWNLOAD_BASE_URL: 'https://dl.example.com/' }));
    ok('eigene Basis-URL: ohne Schraegstrich am Ende, ihr Host ist automatisch erlaubt', andere.download.baseUrl === 'https://dl.example.com' && andere.allowedHosts.includes('dl.example.com') && andere.allowedHosts.includes('mcp.example.com'), andere.allowedHosts);

    // Helfer-Ebene
    const dl = makeDownloads({ secret: GEHEIM, ttlS: 300, maxBytes: 1000, baseUrl: 'https://mcp.example.com' });
    const frisch = dl.token({ vault: 'wissen', path: 'Notiz.md', sub: 'u1' });
    const p0 = dl.pruefe(frisch.token);
    ok('Token: gueltig, nennt Vault, Pfad, sub, Ablauf', p0.ok && p0.vault === 'wissen' && p0.path === 'Notiz.md' && p0.sub === 'u1' && p0.exp === frisch.exp, p0);
    ok('Token nach Ablauf -> "abgelaufen"', dl.pruefe(frisch.token, Date.now() + 301_000).grund === 'abgelaufen');
    const [teil, sig] = frisch.token.split('.');
    const andererPfad = Buffer.from(JSON.stringify({ v: 'wissen', p: '_System/Regeln.md', e: frisch.exp, s: 'u1' })).toString('base64url');
    ok('anderer Pfad mit alter Signatur -> "signatur"', dl.pruefe(andererPfad + '.' + sig).grund === 'signatur');
    ok('verlaengerter Ablauf mit alter Signatur -> "signatur"', dl.pruefe(Buffer.from(JSON.stringify({ v: 'wissen', p: 'Notiz.md', e: frisch.exp + 9999, s: 'u1' })).toString('base64url') + '.' + sig).grund === 'signatur');
    ok('anderes Geheimnis -> "signatur"', makeDownloads({ secret: GEHEIM + 'x', ttlS: 300, maxBytes: 1000, baseUrl: 'x' }).pruefe(frisch.token).grund === 'signatur');
    ok('Muell -> "form"', dl.pruefe('abc').grund === 'form' && dl.pruefe('').grund === 'form' && dl.pruefe(undefined).grund === 'form' && dl.pruefe(teil + '.' + 'A'.repeat(42)).grund === 'form');
    ok('Content-Disposition: ASCII-Rueckfall + UTF-8-Name', contentDisposition('Bericht – Übersicht "final".html')
      === `attachment; filename="Bericht _ _bersicht _final_.html"; filename*=UTF-8''Bericht%20%E2%80%93%20%C3%9Cbersicht%20%22final%22.html`, contentDisposition('Bericht – Übersicht "final".html'));

    // Dateien: Binaerdatei (3 MB) und HTML mit Umlaut im Namen
    mkdirSync(vaultPfad('wissen', 'Dateien'), { recursive: true });
    const gross = randomBytes(3 * 1024 * 1024);
    writeFileSync(vaultPfad('wissen', 'Dateien', 'gross.bin'), gross);
    const HTML = '<!DOCTYPE html><html><body><script>document.title="x"</script>Übersicht</body></html>';
    writeFileSync(vaultPfad('wissen', 'Dateien', 'Bericht – Übersicht.html'), HTML, 'utf8');
    mkdirSync(vaultPfad('wissen', '.trash', 'x'), { recursive: true });
    writeFileSync(vaultPfad('wissen', '.trash', 'x', 'Alt.md'), 'weg', 'utf8');

    const aus = await t.starte(t.baueApp(loadHttpConfig(ENV)));
    ok('ohne Geheimnis: kein Tool datei_link', !(await t.toolNamen(aus)).includes('datei_link') && (await t.rufer(aus)('datei_link', { path: 'Notiz.md' })).fehler);
    ok('ohne Geheimnis: /dl/... -> 404', (await t.anfrage(aus, { method: 'GET', path: '/dl/' + frisch.token + '/Notiz.md' })).status === 404);

    const port = await t.starte(t.baueApp(cfg));
    const ruf = t.rufer(port);
    const namen = await t.toolNamen(port);
    ok('mit Geheimnis (nur lesen): Lese-Tools + datei_link', sortiert(namen) === sortiert([...REMOTE_READ_TOOLS, 'datei_link']), namen.join());
    const init = await t.anfrage(port, { token: t.GUT, body: t.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '0' } }) });
    ok('initialize: Hinweistext erklaert datei_link', /datei_link/.test(init.json?.result?.instructions ?? ''));

    const l = await ruf('datei_link', { path: 'Dateien/gross.bin' });
    ok('datei_link: url, Groesse, Ablauf', !l.fehler && l.json?.bytes === gross.length && /^https:\/\/mcp\.example\.com\/dl\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}\/gross\.bin$/.test(l.json?.url ?? '')
      && Math.abs(Date.parse(l.json.gueltigBis) - Date.now() - 300_000) < 5000, l.text);
    ok('das Geheimnis steht in keinem Tool-Ergebnis', !l.text.includes(GEHEIM));
    const pfadVon = (u) => new URL(u).pathname;
    const holen = (u, opt = {}) => t.anfrage(port, { method: 'GET', path: pfadVon(u), ...opt });
    const d = await holen(l.json.url);
    ok('GET ohne Bearer-Token liefert die Datei bytegenau (3 MB)', d.status === 200 && d.buffer.equals(gross), `${d.status} ${d.buffer.length}`);
    ok('Kopfzeilen: Anhang, Binaerdaten, Laenge, nosniff, no-store, CSP sandbox', /^attachment; filename="gross\.bin"/.test(d.headers['content-disposition'] ?? '')
      && d.headers['content-type'] === 'application/octet-stream' && d.headers['content-length'] === String(gross.length) && d.headers['x-content-type-options'] === 'nosniff'
      && d.headers['cache-control'] === 'no-store' && /sandbox/.test(d.headers['content-security-policy'] ?? ''), d.headers);
    ok('zweiter Abruf innerhalb der Laufzeit geht ebenfalls', (await holen(l.json.url)).status === 200);
    const kopf = await holen(l.json.url, { method: 'HEAD' });
    ok('HEAD: Kopfzeilen ohne Inhalt', kopf.status === 200 && kopf.buffer.length === 0 && kopf.headers['content-length'] === String(gross.length));
    ok('POST auf den Link -> 405', (await holen(l.json.url, { method: 'POST', body: {} })).status === 405);
    ok('falscher Host -> 403 (Host-Allowlist gilt auch hier)', (await holen(l.json.url, { headers: { host: 'boese.example.com' } })).status === 403);

    const h = await ruf('datei_link', { path: 'Dateien/Bericht – Übersicht.html' });
    const hd = await holen(h.json.url);
    ok('HTML mit Umlaut im Namen: Inhalt gleich, wird als Anhang und nicht als text/html ausgeliefert', hd.status === 200 && hd.text === HTML && hd.headers['content-type'] === 'application/octet-stream'
      && (hd.headers['content-disposition'] ?? '').includes("filename*=UTF-8''Bericht%20%E2%80%93%20%C3%9Cbersicht.html"), hd.headers);
    const nurToken = await t.anfrage(port, { method: 'GET', path: pfadVon(h.json.url).split('/').slice(0, 3).join('/') });
    ok('der Dateiname im Link ist Zierde: /dl/<token> allein liefert dieselbe Datei', nurToken.status === 200 && nurToken.text === HTML);
    const falscherName = await t.anfrage(port, { method: 'GET', path: pfadVon(h.json.url).split('/').slice(0, 3).join('/') + '/Notiz.md' });
    ok('ein anderer Name im Link aendert nicht, WAS ausgeliefert wird', falscherName.status === 200 && falscherName.text === HTML);

    // Ungueltige Links
    const tok = pfadVon(l.json.url).split('/')[2];
    const [tt, ss] = tok.split('.');
    const kipp = (x) => x.slice(0, -1) + (x.endsWith('A') ? 'B' : 'A');
    for (const [name, kaputt] of [['Signatur veraendert', tt + '.' + kipp(ss)], ['Inhalt veraendert', kipp(tt) + '.' + ss], ['ohne Signatur', tt], ['leer', 'x']]) {
      const r = await t.anfrage(port, { method: 'GET', path: '/dl/' + kaputt + '/gross.bin' });
      ok(`${name} -> 404 ohne Inhalt`, r.status === 404 && r.buffer.length < 200, `${r.status} ${r.buffer.length}`);
    }
    const eigene = makeDownloads({ ...cfg.download });
    const alt = eigene.token({ vault: 'wissen', path: 'Notiz.md', now: Date.now() - 301_000 });
    const abg = await t.anfrage(port, { method: 'GET', path: '/dl/' + alt.token + '/Notiz.md' });
    ok('abgelaufener Link -> 410 mit Klartext, ohne Datei', abg.status === 410 && /abgelaufen/.test(abg.text) && !abg.text.includes('Leuchtturm'), `${abg.status} ${abg.text}`);
    const priv = await t.anfrage(port, { method: 'GET', path: '/dl/' + eigene.token({ vault: 'privat', path: 'Geheim.md' }).token + '/Geheim.md' });
    ok('echte Signatur, aber nicht freigegebener Vault -> 404, kein Inhalt', priv.status === 404 && !priv.text.includes('Zitronenfalter'), `${priv.status} ${priv.text}`);
    const versteckt = await t.anfrage(port, { method: 'GET', path: '/dl/' + eigene.token({ vault: 'wissen', path: '.trash/x/Alt.md' }).token + '/Alt.md' });
    ok('echte Signatur, aber versteckter Ordner -> 404', versteckt.status === 404 && versteckt.text !== 'weg');
    const raus = await t.anfrage(port, { method: 'GET', path: '/dl/' + eigene.token({ vault: 'wissen', path: '../privat/Geheim.md' }).token + '/Geheim.md' });
    ok('echte Signatur, aber Pfad aus dem Vault heraus -> 404', raus.status === 404 && !raus.text.includes('Zitronenfalter'));

    // datei_link lehnt ab, was nicht ausgeliefert werden darf
    for (const [name, args] of [['versteckter Ordner', { path: '.trash/x/Alt.md' }], ['Pfad aus dem Vault heraus', { path: '../privat/Geheim.md' }], ['Ordner', { path: 'Dateien' }],
      ['fehlende Datei', { path: 'Dateien/fehlt.pdf' }], ['nicht freigegebener Vault', { path: 'Geheim.md', vault: 'privat' }], ['absoluter Pfad', { path: '/etc/hostname' }]]) {
      const r = await ruf('datei_link', args);
      ok(`datei_link: ${name} -> Fehler, kein Link`, r.fehler && !/\/dl\//.test(r.text), r.text);
    }
    let link = false;
    try { symlinkSync(vaultPfad('privat', 'Geheim.md'), vaultPfad('wissen', 'Dateien', 'verknuepft.md')); link = true; } catch { /* z. B. Windows ohne Entwicklermodus */ }
    if (link) {
      const r = await ruf('datei_link', { path: 'Dateien/verknuepft.md' });
      ok('Symlink aus dem Vault heraus -> Fehler, kein Link', r.fehler && !/\/dl\//.test(r.text), r.text);
      const s2 = await t.anfrage(port, { method: 'GET', path: '/dl/' + eigene.token({ vault: 'wissen', path: 'Dateien/verknuepft.md' }).token + '/v.md' });
      ok('Symlink aus dem Vault heraus mit echter Signatur -> 404', s2.status === 404 && !s2.text.includes('Zitronenfalter'));
      rmSync(vaultPfad('wissen', 'Dateien', 'verknuepft.md'), { force: true });
    } else console.log('  (Symlink-Fall uebersprungen: Symlinks hier nicht moeglich)');

    // Groessengrenze und Datei, die sich nach dem Link aendert
    const klein = await t.starte(t.baueApp(loadHttpConfig(dlEnv({ NEXUS_MCP_DOWNLOAD_MAX_BYTES: '2048' }))));
    const zuGross = await t.rufer(klein)('datei_link', { path: 'Dateien/gross.bin' });
    ok('ueber der Groessengrenze: Fehler nennt Groesse und Limit', zuGross.fehler && /3145728 Bytes, Limit 2048/.test(zuGross.text), zuGross.text);
    const n = await t.rufer(klein)('datei_link', { path: 'Notiz.md' });
    writeFileSync(vaultPfad('wissen', 'Wachsend.md'), 'klein', 'utf8');
    const w = await t.rufer(klein)('datei_link', { path: 'Wachsend.md' });
    writeFileSync(vaultPfad('wissen', 'Wachsend.md'), 'x'.repeat(5000), 'utf8');
    ok('Datei nach dem Link ueber das Limit gewachsen -> 404', !w.fehler && (await t.anfrage(klein, { method: 'GET', path: pfadVon(w.json.url) })).status === 404);
    rmSync(vaultPfad('wissen', 'Wachsend.md'), { force: true });
    ok('Datei nach dem Link geloescht -> 404', (await t.anfrage(klein, { method: 'GET', path: pfadVon(w.json.url) })).status === 404);
    ok('kleine Datei unter dem Limit: Link funktioniert', !n.fehler && (await t.anfrage(klein, { method: 'GET', path: pfadVon(n.json.url) })).status === 200);
    const fremderServer = await t.starte(t.baueApp(loadHttpConfig(dlEnv({ NEXUS_MCP_DOWNLOAD_SECRET: GEHEIM + '-anders' }))));
    ok('anderes Geheimnis am Server -> 404', (await t.anfrage(fremderServer, { method: 'GET', path: pfadVon(n.json.url) })).status === 404);

    // Aufruf-Log und Audit-Log
    const logs = t.logZeilen.map(z => JSON.parse(z));
    const dz = logs.filter(z => z.tool === 'download');
    ok('Aufruf-Log: Download mit sub, Vault, Pfad, Ergebnis', dz.some(z => z.ergebnis === 'ok' && z.pfad === 'Dateien/gross.bin' && z.vault === 'wissen' && z.sub === '00000000-0000-4000-8000-000000000001' && z.status === 200), dz[0]);
    ok('Aufruf-Log: Gruende fuer abgelehnte Links', ['link_signatur', 'link_form', 'link_abgelaufen', 'datei_fehlt'].every(g => dz.some(z => z.ergebnis === g)), [...new Set(dz.map(z => z.ergebnis))].join());
    ok('weder Geheimnis noch Token stehen im Aufruf-Log', !t.logZeilen.some(z => z.includes(GEHEIM) || z.includes(ss)));
    const eigenesAudit = join(t.scratch, 'audit-dl', 'a.jsonl');
    const mitAudit = await t.starte(t.baueApp(loadHttpConfig(dlEnv({ NEXUS_MCP_AUDIT_LOG: eigenesAudit }))));
    const la = await t.rufer(mitAudit)('datei_link', { path: 'Notiz.md' });
    await t.anfrage(mitAudit, { method: 'GET', path: pfadVon(la.json.url) });
    const az = auditZeilen(eigenesAudit);
    ok('mit Audit-Log: je eine Zeile fuer den Link und fuer den Abruf', az.some(z => z.tool === 'datei_link' && z.pfad === 'Notiz.md' && z.ergebnis === 'ok') && az.some(z => z.tool === 'download' && z.pfad === 'Notiz.md' && z.vault === 'wissen'), az);
    ok('kein Token im Audit-Log', !readFileSync(eigenesAudit, 'utf8').includes('/dl/'));

    const fremdBasis = await t.starte(t.baueApp(andere));
    const fb = await t.rufer(fremdBasis)('datei_link', { path: 'Notiz.md' });
    ok('eigene Basis-URL steht im Link und ihr Host wird angenommen', /^https:\/\/dl\.example\.com\/dl\//.test(fb.json?.url ?? '')
      && (await t.anfrage(fremdBasis, { method: 'GET', path: pfadVon(fb.json.url), headers: { host: 'dl.example.com' } })).status === 200, fb.text);
  }
} catch (e) {
  console.error('  \x1b[31m✗ Testlauf-Fehler:\x1b[0m', e.stack || e.message);
  fail++;
} finally {
  await t.schliessen();
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exitCode = fail === 0 ? 0 : 1;
