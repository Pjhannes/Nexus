// test/mcp-http-write.test.mjs – R31: Remote-Connector schreibend (Stufen, Regeln).
//
//   1. Konfiguration der Stufen (NEXUS_MCP_LEVELS) – Standard bleibt nur lesen
//   2. Stufe "write": Schreib-Tools sichtbar und wirksam, nur im freigegebenen Vault
//   3. Regeln je Aufruf: kein endgueltiges Loeschen, _System geschuetzt, vault_check als Trockenlauf
//   4. Stufe "admin": delete landet im Papierkorb, reindex, vault_check mit Bericht
// Aufbau: test/mcp-http-helfer.mjs. Lauf: node test/mcp-http-write.test.mjs
import { existsSync, readFileSync, readdirSync } from 'fs';
import { aufbau } from './mcp-http-helfer.mjs';
import { loadHttpConfig } from '../src/mcp/http-config.js';
import { REMOTE_READ_TOOLS, REMOTE_WRITE_TOOLS, REMOTE_ADMIN_TOOLS, remotePolicy, remoteGuard } from '../src/mcp/remote-policy.js';

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
const schreibEnv = (levels, extra = {}) => ({ ...ENV, NEXUS_MCP_LEVELS: levels, ...extra });

try {
  // ── 1. Konfiguration ───────────────────────────────────────────────────────
  console.log('1. Stufen-Konfiguration');
  {
    ok('Standard: nur "read"', loadHttpConfig(ENV).levels.join() === 'read');
    ok('"write" einschalten', loadHttpConfig(schreibEnv('write')).levels.join() === 'read,write');
    ok('"admin" getrennt schaltbar, Reihenfolge und Gross/Klein egal', loadHttpConfig(schreibEnv(' Admin , WRITE')).levels.join() === 'read,write,admin'
      && loadHttpConfig(schreibEnv('admin')).levels.join() === 'read,admin');
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

    const fremd = await ruf('write_note', { path: 'Neu.md', content: 'x', create: true, vault: 'privat' });
    ok('Schreiben in einen nicht freigegebenen Vault -> Fehler, nichts angelegt', fremd.fehler && !existsSync(vaultPfad('privat', 'Neu.md')), fremd.text);
    const raus = await ruf('write_note', { path: '../privat/Raus.md', content: 'x', create: true });
    ok('Pfad aus dem Vault heraus -> Fehler, nichts angelegt', raus.fehler && !existsSync(vaultPfad('privat', 'Raus.md')), raus.text);
    for (const n of REMOTE_ADMIN_TOOLS) ok(`${n} ist auf Stufe write nicht aufrufbar`, (await ruf(n, { path: 'Notiz.md' })).fehler);
    ok('Notiz.md liegt nach dem delete-Versuch noch da', existsSync(vaultPfad('wissen', 'Notiz.md')));

    const vc = await ruf('vault_check', {});
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
    const trick = await ruf('move', { from: '_System/Regeln.md', to: '.trash/Regeln.md' });
    ok('move nach .trash -> Fehler, Datei bleibt', trick.fehler && existsSync(vaultPfad('wissen', '_System', 'Regeln.md')), trick.text);
    const zurueck = await ruf('restore', { path: weg.json.trashed });
    ok('restore holt die Notiz zurueck', !zurueck.fehler && existsSync(vaultPfad('wissen', 'Remote', 'Ordner', 'Neu.md')), zurueck.text);
    ok('reindex', (await ruf('reindex', {})).json?.ok === true);
    const vc = await ruf('vault_check', {});
    ok('vault_check mit admin schreibt den Bericht', !vc.fehler && vc.json?.reportPath === '_System/Vault-Check.md' && existsSync(vaultPfad('wissen', '_System', 'Vault-Check.md')), vc.text);
    ok('im nicht freigegebenen Vault ist nichts entstanden', readdirSync(vaultPfad('privat')).join() === 'Geheim.md', readdirSync(vaultPfad('privat')).join());
  }
} catch (e) {
  console.error('  \x1b[31m✗ Testlauf-Fehler:\x1b[0m', e.stack || e.message);
  fail++;
} finally {
  await t.schliessen();
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exitCode = fail === 0 ? 0 : 1;
