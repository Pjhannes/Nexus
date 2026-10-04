// test/mcp-schema.test.mjs – Tool-Schemas aus Client-Sicht (Cowork-/Agent-SDK-Fix 2026-10-04).
//
// Spricht den Server mit dem OFFIZIELLEN SDK-Client (StdioClientTransport) statt mit dem
// Mini-Client aus mcp-client.mjs – denn genau dieser Client (und Cowork obendrauf) prueft
// structuredContent gegen das outputSchema, das er vorher per tools/list bekommen hat.
//
// Was dieser Test BEWEIST:
//   1. Kein Tool-Schema traegt "$schema" (das SDK schreibt sonst draft-07 hinein; Cowork
//      validiert mit Ajv 2020-12 und lehnt den Dialekt ab -> "unsupported dialect").
//   2. Jedes outputSchema kompiliert unter Ajv 2020-12 (Cowork-Dialekt).
//   3. Jedes Tool mit outputSchema liefert structuredContent, das der Client-Validator
//      akzeptiert – auch mit Zusatzfeldern (samples, dryRun, retentionDays, ...), weil die
//      Ausgabe-Schemas offen sind (kein additionalProperties:false).
// Alles im Temp-Scratch, kein Zugriff auf echte Daten.
// Lauf: node test/mcp-schema.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dir, '..', 'src', 'server.js');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra ? `\n     Kontext: ${String(extra).slice(0, 300)}` : ''); fail++; }
}

// Ajv 2020-12 wie in Cowork – ajv ist eine (transitive) SDK-Abhaengigkeit; fehlt der
// Dialekt-Build, wird nur dieser eine Punkt uebersprungen, der Rest laeuft.
let Ajv2020 = null;
try { Ajv2020 = (await import('ajv/dist/2020.js')).default; } catch { /* kein ajv/2020 auffindbar */ }

// ── Scratch ──────────────────────────────────────────────────────────────────
const scratch = mkdtempSync(join(tmpdir(), 'nexus-schema-test-'));
const vaultDir = join(scratch, 'tv');
mkdirSync(join(vaultDir, '_System', 'Lernen'), { recursive: true });
writeFileSync(join(vaultDir, 'Start.md'), '# Start\n\nHallo [[Zwei]] und [[Fehlt]].\n', 'utf8');
writeFileSync(join(vaultDir, 'Zwei.md'), '---\ntags: [test]\n---\n# Zwei\n\nNoch eine Notiz.\n', 'utf8');
writeFileSync(join(vaultDir, 'Weg.md'), '# Weg\n\nKommt in den Papierkorb.\n', 'utf8');
writeFileSync(join(vaultDir, '_System', 'Lernen', 'faecher.json'),
  JSON.stringify({ faecher: [{ name: 'Physik', pruefung: '2099-01-01' }] }), 'utf8');
writeFileSync(join(scratch, 'nexus.config.json'), JSON.stringify({
  vaultsRoot: scratch,
  activeVault: 'tv',
  vaults: [{ name: 'tv', path: vaultDir, dbPath: '.nexus/tv.db' }],
  ui: { port: 3997, autoOpen: false },
  ignore: ['.obsidian', '.trash', '.nexus', 'node_modules'],
}, null, 2), 'utf8');

// ── Client mit 2020-12-Validator (falls verfuegbar), sonst SDK-Standard ──────
const transport = new StdioClientTransport({
  command: process.execPath, args: [SERVER_JS],
  env: { ...process.env, NEXUS_DATA_DIR: scratch }, stderr: 'pipe',
});
let stderrTail = '';
transport.stderr?.on('data', d => { stderrTail = (stderrTail + d.toString()).slice(-2000); });
const clientOpts = Ajv2020
  ? { jsonSchemaValidator: new AjvJsonSchemaValidator(new Ajv2020({ strict: false, validateSchema: false, allErrors: true })) }
  : {};
const client = new Client({ name: 'nexus-schema-test', version: '0.0.0' }, clientOpts);

let exitCode = 1;
try {
  await client.connect(transport);
  const { tools } = await client.listTools();   // fuellt den Output-Validator-Cache des Clients
  ok('tools/list liefert Werkzeuge', tools.length >= 15, `nur ${tools.length}`);

  const mitSchema = tools.filter(t => '$schema' in (t.inputSchema ?? {}) || '$schema' in (t.outputSchema ?? {})).map(t => t.name);
  ok('kein Tool traegt "$schema" (weder input- noch outputSchema)', mitSchema.length === 0, mitSchema.join(','));

  const mitOutput = tools.filter(t => t.outputSchema);
  ok('mindestens 7 Tools mit outputSchema', mitOutput.length >= 7, mitOutput.map(t => t.name).join(','));
  ok('outputSchemas sind offen (kein additionalProperties:false an der Wurzel)',
    mitOutput.every(t => t.outputSchema.additionalProperties !== false),
    mitOutput.filter(t => t.outputSchema.additionalProperties === false).map(t => t.name).join(','));

  if (Ajv2020) {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const kaputt = [];
    for (const t of mitOutput) { try { ajv.compile(t.outputSchema); } catch (e) { kaputt.push(`${t.name}: ${e.message}`); } }
    ok('alle outputSchemas kompilieren unter Ajv 2020-12 (Cowork-Dialekt)', kaputt.length === 0, kaputt.join(' | '));
    // Gegenprobe: MIT "$schema": draft-07 lehnt derselbe Ajv ab – das war der Cowork-Fehler.
    let abgelehnt = false;
    try { ajv.compile({ ...mitOutput[0].outputSchema, $schema: 'http://json-schema.org/draft-07/schema#' }); } catch { abgelehnt = true; }
    ok('Gegenprobe: mit "$schema" draft-07 lehnt Ajv 2020-12 ab', abgelehnt);
  } else {
    console.log('  (Hinweis: ajv/dist/2020.js nicht auffindbar – Dialekt-Pruefung uebersprungen)');
  }

  // Jedes Tool mit outputSchema einmal real aufrufen – der Client validiert structuredContent
  // gegen das gecachte outputSchema und wirft bei Abweichung (so faellt Cowork heute um).
  const aufrufe = [
    ['list_vaults', {}],
    ['search',      { q: 'Notiz' }],
    ['list_notes',  {}],
    ['dataview',    { source: 'TABLE file.name FROM ""' }],
    ['lern_status', {}],
    ['delete',      { path: 'Weg.md' }],          // fuellt den Papierkorb fuer list_trash
    ['list_trash',  {}],
    ['vault_check', { dry_run: true }],
  ];
  const geprueft = new Set();
  for (const [name, args] of aufrufe) {
    let r, err;
    try { r = await client.callTool({ name, arguments: args }); } catch (e) { err = e; }
    const hatOutput = mitOutput.some(t => t.name === name);
    if (hatOutput) {
      geprueft.add(name);
      ok(`${name}: Ergebnis passiert die Client-Validierung (structuredContent ~ outputSchema)`,
        !err && r?.isError !== true && r?.structuredContent && typeof r.structuredContent === 'object',
        err?.message ?? (r?.isError ? r.content?.[0]?.text : JSON.stringify(r?.structuredContent).slice(0, 200)));
    } else {
      ok(`${name}: Aufruf ohne Fehler`, !err && r?.isError !== true, err?.message ?? r?.content?.[0]?.text);
    }
  }
  const vergessen = mitOutput.map(t => t.name).filter(n => !geprueft.has(n));
  ok('jedes Tool mit outputSchema wurde aufgerufen', vergessen.length === 0, `fehlt: ${vergessen.join(',')}`);

  // Konkrete Zusatzfelder, die frueher am additionalProperties:false scheiterten:
  const vc = await client.callTool({ name: 'vault_check', arguments: { dry_run: true } });
  ok('vault_check: Zusatzfelder samples/dryRun kommen durch', vc.structuredContent?.dryRun === true && !!vc.structuredContent?.samples,
    JSON.stringify(vc.structuredContent).slice(0, 200));
  ok('vault_check: summary zaehlt den kaputten Link [[Fehlt]]', vc.structuredContent?.summary?.brokenLinks === 1,
    JSON.stringify(vc.structuredContent?.summary));
  const lt = await client.callTool({ name: 'list_trash', arguments: {} });
  ok('list_trash: Zusatzfeld retentionDays kommt durch', typeof lt.structuredContent?.retentionDays === 'number' && lt.structuredContent?.gesamt === 1,
    JSON.stringify(lt.structuredContent).slice(0, 200));

  exitCode = 0;
} catch (e) {
  console.error('  \x1b[31m✗ Testlauf-Fehler:\x1b[0m', e.message);
  console.error('  Server-stderr (Tail):', stderrTail.slice(-600) || '(leer)');
  fail++;
} finally {
  try { await client.close(); } catch {}
  await new Promise(r => setTimeout(r, 300));
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch { console.log('  (Hinweis: Scratch-Ordner nicht entfernt – EPERM/WAL, unkritisch)'); }
}

console.log(`\n${fail === 0 ? '\x1b[32m' : '\x1b[31m'}${pass} bestanden, ${fail} Fehler\x1b[0m`);
process.exit(fail === 0 ? exitCode : 1);
