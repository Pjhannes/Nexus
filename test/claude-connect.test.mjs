// test/claude-connect.test.mjs – Verifiziert src/claude-connect.js OHNE Pauls echte
// claude_desktop_config.json anzufassen: APPDATA wird fuer die Testlaufzeit auf einen
// Temp-Ordner umgebogen (claudeConfigPath() liest process.env.APPDATA live, kein Caching).
// Lauf: node test/claude-connect.test.mjs   (aus D:\Nexus bzw. /tmp-Kopie in der Sandbox)
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { claudeConfigPath, connectClaude, migrateClaudeEntryIfStale } from '../src/claude-connect.js';

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label); fail++; }
}

const scratch = mkdtempSync(join(tmpdir(), 'nexus-claude-connect-test-'));
const origAppData = process.env.APPDATA;
process.env.APPDATA = scratch;

try {
  const cfgPath = claudeConfigPath();
  ok('claudeConfigPath() liegt im Scratch-Ordner', cfgPath.startsWith(scratch));
  ok('claudeConfigPath() endet auf Claude\\claude_desktop_config.json', /Claude[\\/]claude_desktop_config\.json$/.test(cfgPath));

  // ── Fall 1: keine bestehende Datei -> anlegen, kein Backup ──
  {
    const spec = { command: 'C:\\node.exe', args: ['D:\\Nexus\\src\\server.js'], env: {} };
    const r = connectClaude({ launchSpec: spec, mcpKey: 'nexus' });
    ok('Fall 1: ok:true', r.ok === true);
    ok('Fall 1: backedUp:false (Datei existierte nicht)', r.backedUp === false);
    ok('Fall 1: Datei wurde angelegt', existsSync(cfgPath));
    const written = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('Fall 1: mcpServers.nexus.command korrekt', written.mcpServers.nexus.command === spec.command);
    ok('Fall 1: mcpServers.nexus.args korrekt', JSON.stringify(written.mcpServers.nexus.args) === JSON.stringify(spec.args));
  }

  // ── Fall 2: bestehende Datei mit Fremdeintrag -> Merge + Backup, Fremdeintrag bleibt ──
  {
    writeFileSync(cfgPath, JSON.stringify({ mcpServers: { fremd: { command: 'x' } } }, null, 2), 'utf8');
    const spec = { command: 'C:\\node2.exe', args: ['server.js'], env: { NEXUS_DATA_DIR: 'D:\\Data' } };
    const r = connectClaude({ launchSpec: spec, mcpKey: 'nexus' });
    ok('Fall 2: backedUp:true (Datei existierte)', r.backedUp === true);
    ok('Fall 2: Backup-Datei existiert', existsSync(cfgPath + '.nexus-backup'));
    const backup = JSON.parse(readFileSync(cfgPath + '.nexus-backup', 'utf8'));
    ok('Fall 2: Backup enthaelt den alten Stand', backup.mcpServers.fremd.command === 'x');
    const written = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('Fall 2: Fremdeintrag bleibt erhalten (kein Ueberschreiben)', written.mcpServers.fremd.command === 'x');
    ok('Fall 2: neuer nexus-Eintrag korrekt', written.mcpServers.nexus.command === spec.command);
    ok('Fall 2: env wird durchgereicht', written.mcpServers.nexus.env.NEXUS_DATA_DIR === 'D:\\Data');
  }

  // ── Fall 3: mcpKey "nexus-dev" ueberschreibt NICHT den "nexus"-Eintrag ──
  {
    const spec = { command: 'C:\\node-dev.exe', args: ['server.js'], env: {} };
    connectClaude({ launchSpec: spec, mcpKey: 'nexus-dev' });
    const written = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('Fall 3: nexus-dev-Eintrag gesetzt', written.mcpServers['nexus-dev'].command === spec.command);
    ok('Fall 3: nexus-Eintrag (Fall 2) bleibt unangetastet', written.mcpServers.nexus.command === 'C:\\node2.exe');
  }

  // ── Fall 4: kaputtes JSON in der bestehenden Datei -> faengt ab statt zu werfen ──
  {
    writeFileSync(cfgPath, '{ das ist kein json', 'utf8');
    let threw = false;
    let r;
    try { r = connectClaude({ launchSpec: { command: 'x', args: [], env: {} }, mcpKey: 'nexus' }); }
    catch (e) { threw = true; }
    ok('Fall 4: wirft NICHT bei kaputtem JSON', !threw);
    ok('Fall 4: schreibt trotzdem einen gueltigen neuen Stand', r && r.ok === true);
    const written = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('Fall 4: mcpServers.nexus nach Reset gesetzt', written.mcpServers.nexus.command === 'x');
  }

  // ═══ Phase 3: migrateClaudeEntryIfStale ═══
  const NEW_SPEC = { command: 'C:\\Program Files\\Nexus\\node.exe', args: ['C:\\Program Files\\Nexus\\resources\\src\\server.js'], env: { NEXUS_DATA_DIR: 'C:\\Users\\x\\AppData\\Roaming\\Nexus' } };

  // ── Fall 5: kein Eintrag -> legt NIE einen an ──
  {
    writeFileSync(cfgPath, JSON.stringify({ mcpServers: { fremd: { command: 'x' } } }, null, 2), 'utf8');
    rmSync(cfgPath + '.nexus-backup', { force: true });
    const r = migrateClaudeEntryIfStale({ launchSpec: NEW_SPEC, mcpKey: 'nexus' });
    ok('Fall 5: migrated:false ohne Eintrag', r.migrated === false && r.reason === 'kein Eintrag');
    const w = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('Fall 5: kein nexus-Eintrag angelegt', !w.mcpServers.nexus);
    ok('Fall 5: kein Backup erzeugt', !existsSync(cfgPath + '.nexus-backup'));
  }

  // ── Fall 6: alter Electron-Trick-Eintrag -> wird migriert (mit Backup) ──
  {
    writeFileSync(cfgPath, JSON.stringify({ mcpServers: {
      fremd: { command: 'x' },
      nexus: { command: 'C:\\Users\\x\\AppData\\Local\\Programs\\Nexus\\Nexus.exe', args: ['C:\\...\\src\\server.js'], env: { ELECTRON_RUN_AS_NODE: '1', NEXUS_DATA_DIR: 'C:\\Users\\x\\AppData\\Roaming\\Nexus' } },
    } }, null, 2), 'utf8');
    rmSync(cfgPath + '.nexus-backup', { force: true });
    const r = migrateClaudeEntryIfStale({ launchSpec: NEW_SPEC, mcpKey: 'nexus' });
    ok('Fall 6: migrated:true bei Electron-Trick', r.migrated === true);
    ok('Fall 6: Backup existiert', existsSync(cfgPath + '.nexus-backup'));
    const w = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('Fall 6: command auf Node-Sidecar umgeschrieben', w.mcpServers.nexus.command === NEW_SPEC.command);
    ok('Fall 6: kein ELECTRON_RUN_AS_NODE mehr', !w.mcpServers.nexus.env.ELECTRON_RUN_AS_NODE);
    ok('Fall 6: Fremdeintrag ueberlebt Migration', w.mcpServers.fremd.command === 'x');
  }

  // ── Fall 7: Eintrag bereits aktuell -> idempotent, KEIN erneuter Write/Backup ──
  {
    rmSync(cfgPath + '.nexus-backup', { force: true });
    const before = readFileSync(cfgPath, 'utf8');
    const r = migrateClaudeEntryIfStale({ launchSpec: NEW_SPEC, mcpKey: 'nexus' });
    ok('Fall 7: migrated:false wenn aktuell', r.migrated === false && r.reason === 'aktuell');
    ok('Fall 7: Datei byte-identisch (kein Write)', readFileSync(cfgPath, 'utf8') === before);
    ok('Fall 7: kein Backup-Churn', !existsSync(cfgPath + '.nexus-backup'));
  }

  // ── Fall 8: anderer Install-Pfad (App-Update) -> wird migriert ──
  {
    const moved = { ...NEW_SPEC, command: 'D:\\Neuer Ort\\Nexus\\node.exe' };
    const r = migrateClaudeEntryIfStale({ launchSpec: moved, mcpKey: 'nexus' });
    ok('Fall 8: migrated:true bei geaendertem command', r.migrated === true);
    const w = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('Fall 8: neuer Pfad geschrieben', w.mcpServers.nexus.command === moved.command);
  }

  // ── Fall 9: gar keine Claude-Config-Datei -> fasst nichts an ──
  {
    rmSync(cfgPath, { force: true });
    rmSync(cfgPath + '.nexus-backup', { force: true });
    const r = migrateClaudeEntryIfStale({ launchSpec: NEW_SPEC, mcpKey: 'nexus' });
    ok('Fall 9: migrated:false ohne Config-Datei', r.migrated === false && r.reason === 'keine Claude-Config');
    ok('Fall 9: es wird KEINE Datei erzeugt', !existsSync(cfgPath));
  }

  // ── Fall 10: korruptes JSON -> Migration schreibt NICHT (Gegenteil von connectClaude!) ──
  // Regressions-Schutz: ein kuenftiger Refactor, der die Lese-Pfade vereinigt,
  // wuerde sonst kaputte Configs bei jedem App-Start still zuruecksetzen.
  {
    writeFileSync(cfgPath, '{ kaputt', 'utf8');
    rmSync(cfgPath + '.nexus-backup', { force: true });
    const r = migrateClaudeEntryIfStale({ launchSpec: NEW_SPEC, mcpKey: 'nexus' });
    ok('Fall 10: migrated:false bei kaputtem JSON', r.migrated === false && r.reason === 'Claude-Config unlesbar');
    ok('Fall 10: Datei bleibt unangetastet (kein Reset!)', readFileSync(cfgPath, 'utf8') === '{ kaputt');
    ok('Fall 10: kein Backup', !existsSync(cfgPath + '.nexus-backup'));
  }

  // ── Fall 11: Eintrag ohne args (handeditiert) -> gilt als veraltet -> migriert ──
  {
    writeFileSync(cfgPath, JSON.stringify({ mcpServers: { nexus: { command: NEW_SPEC.command } } }, null, 2), 'utf8');
    const r = migrateClaudeEntryIfStale({ launchSpec: NEW_SPEC, mcpKey: 'nexus' });
    ok('Fall 11: args undefined -> migriert', r.migrated === true);
    const w = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('Fall 11: args nachgezogen', JSON.stringify(w.mcpServers.nexus.args) === JSON.stringify(NEW_SPEC.args));
  }

  // ── Fall 12: NUR NEXUS_DATA_DIR weicht ab -> migriert (isolierter env-Trigger) ──
  {
    const w0 = JSON.parse(readFileSync(cfgPath, 'utf8'));
    w0.mcpServers.nexus.env = { NEXUS_DATA_DIR: 'C:\\ALTER Ort\\Nexus' };
    writeFileSync(cfgPath, JSON.stringify(w0, null, 2), 'utf8');
    const r = migrateClaudeEntryIfStale({ launchSpec: NEW_SPEC, mcpKey: 'nexus' });
    ok('Fall 12: env-NEXUS_DATA_DIR-Abweichung -> migriert', r.migrated === true);
    const w = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('Fall 12: neuer Datenpfad geschrieben', w.mcpServers.nexus.env.NEXUS_DATA_DIR === NEW_SPEC.env.NEXUS_DATA_DIR);
  }

  // ── Fall 13: aktuell, aber mit EXTRA-env-Keys des Nutzers -> bleibt unangetastet ──
  {
    const w0 = JSON.parse(readFileSync(cfgPath, 'utf8'));
    w0.mcpServers.nexus.env.MEIN_EIGENER_KEY = 'bleibt';
    writeFileSync(cfgPath, JSON.stringify(w0, null, 2), 'utf8');
    const before = readFileSync(cfgPath, 'utf8');
    const r = migrateClaudeEntryIfStale({ launchSpec: NEW_SPEC, mcpKey: 'nexus' });
    ok('Fall 13: extra env-Keys machen NICHT stale', r.migrated === false && r.reason === 'aktuell');
    ok('Fall 13: Nutzer-Anpassung ueberlebt (kein Write)', readFileSync(cfgPath, 'utf8') === before);
  }

  // ── Fall 14: Config ganz ohne mcpServers-Objekt -> 'kein Eintrag', kein Write ──
  {
    writeFileSync(cfgPath, JSON.stringify({ irgendwas: true }, null, 2), 'utf8');
    const before = readFileSync(cfgPath, 'utf8');
    const r = migrateClaudeEntryIfStale({ launchSpec: NEW_SPEC, mcpKey: 'nexus' });
    ok('Fall 14: ohne mcpServers -> kein Eintrag', r.migrated === false && r.reason === 'kein Eintrag');
    ok('Fall 14: Datei unveraendert', readFileSync(cfgPath, 'utf8') === before);
  }
} finally {
  process.env.APPDATA = origAppData;
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
