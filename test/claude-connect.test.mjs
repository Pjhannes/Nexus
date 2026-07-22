// test/claude-connect.test.mjs – Verifiziert src/claude-connect.js OHNE Pauls echte
// claude_desktop_config.json anzufassen: APPDATA wird fuer die Testlaufzeit auf einen
// Temp-Ordner umgebogen (claudeConfigPath() liest process.env.APPDATA live, kein Caching).
// Lauf: node test/claude-connect.test.mjs   (aus D:\Nexus bzw. /tmp-Kopie in der Sandbox)
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { claudeConfigPath, connectClaude } from '../src/claude-connect.js';

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
} finally {
  process.env.APPDATA = origAppData;
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? 0 : 1);
