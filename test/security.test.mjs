// test/security.test.mjs – R27a: Sicherheits-Batch Teil 1 + Datenintegritaet.
// Startet den echten ui-server in einem Scratch (eigener NEXUS_DATA_DIR + Vault,
// NIE Pauls Daten) und prueft ueber HTTP:
//   - Bind-Adresse: 127.0.0.1 antwortet, die LAN-IP nicht
//   - UI-Token: 401 ohne Token, ?t= setzt Cookie + Redirect, Header X-Nexus-Token
//   - safeFull-Negativfaelle (Unit, paths.js) + ueber /api/save, /api/upload, /api/convert
//   - 413 bei Body-Limit (2 MB), /api/save atomar (kein .nexustmp-Rest, Read-Back)
//   - /api/file: CSP sandbox fuer .html/.svg, nicht fuer .png
//   - Claude-Auth serverseitig (Key nie in der Antwort, Datei im DATA_DIR)
//   - rename/delete/mkdir ueber tools.* (Sidecar-Mitnahme bleibt)
//   - Start: .nexustmp-Reste geraeumt, Config bekommt schemaVersion + Backup
//   - NEXUS_WEB=1: kein Token, geraetegebundene Routen 403
// Lauf: node test/security.test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir, networkInterfaces } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { safeFull } from '../src/paths.js';
import { buildCsp, inlineScriptHashes, CSP_POLICY_TAURI } from '../src/csp.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const UI_SERVER = join(__dir, '..', 'src', 'ui-server.js');

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { console.log('  \x1b[32m✓\x1b[0m', label); pass++; }
  else      { console.log('  \x1b[31m✗\x1b[0m', label, extra !== undefined ? `\n     Kontext: ${String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400)}` : ''); fail++; }
}

// ── Unit: safeFull ────────────────────────────────────────────────────────────
console.log('\n── 0. safeFull (paths.js) ──');
{
  const root = join(tmpdir(), 'nexus-sf-root');
  const bad = ['../x', '/abs', '\\abs', 'C:\\x', 'C:x', '..\\x', 'a/../../x', '\\\\?\\C:\\x', '\\\\srv\\share', 'a\0b', '..', 'a/..', 'a/b/../c', 5, {}];
  for (const b of bad) ok(`abgelehnt: ${JSON.stringify(b)}`, safeFull(root, b) === null, safeFull(root, b));
  ok('erlaubt: a/b.md', safeFull(root, 'a/b.md') === join(root, 'a', 'b.md'));
  ok('erlaubt: a\\b.md (Windows-Trenner)', safeFull(root, 'a\\b.md') === join(root, 'a', 'b.md'));
  ok('erlaubt: "" -> Wurzel', safeFull(root, '') === join(root));
  ok('erlaubt: undefined -> Wurzel', safeFull(root, undefined) === join(root));
  ok('erlaubt: a/./b', safeFull(root, 'a/./b') === join(root, 'a', 'b'));
}

// ── Unit: CSP-Bausteine + statischer Scan der eigenen HTML-Seiten (R27c) ──────
console.log('\n── 0b. CSP (csp.js), Inline-Handler-Scan, tauri.conf.json, Vendor-Lizenzen ──');
{
  const pub = (p) => readFileSync(join(__dir, '..', 'public', p), 'utf8');
  const idx = pub('index.html');
  const hashes = inlineScriptHashes(idx);
  ok('index.html: 2 Inline-Skripte (Import-Map + App) gehasht', hashes.length === 2 && hashes.every(h => /^'sha256-[A-Za-z0-9+/=]+'$/.test(h)), hashes);
  const csp = buildCsp(idx);
  ok("CSP: script-src 'self' + Hashes, OHNE 'unsafe-inline'", /script-src 'self' 'sha256-/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp), csp);
  ok("CSP: object-src 'none', base-uri 'self', form-action 'self'", csp.includes("object-src 'none'") && csp.includes("base-uri 'self'") && csp.includes("form-action 'self'"));
  ok('CSP: keine CDN-Hosts (KaTeX/Mermaid/DOMPurify lokal)', !/jsdelivr|unpkg|cdnjs/.test(csp));
  ok('CSP: Tauri-IPC in connect-src', /connect-src[^;]*ipc:[^;]*http:\/\/ipc\.localhost/.test(csp));
  ok('CSP: Hash folgt dem Skript-Inhalt', inlineScriptHashes(idx.replace('init();', 'init(); //x'))[1] !== hashes[1]);
  // Browser-Befund R27c: der HTML-Parser hasht den LF-normalisierten Skripttext – CRLF-Dateien muessen denselben Hash liefern.
  ok('CSP: Hash unabhaengig von CRLF/LF (Parser normalisiert)', inlineScriptHashes('<script>\r\nconst a=1;\r\n</script>')[0] === inlineScriptHashes('<script>\nconst a=1;\n</script>')[0]);
  for (const p of ['index.html', 'lernen.html', 'help.html', 'wizard.html', 'update.html']) {
    const h = pub(p);
    const markup = h.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const inl = markup.match(/<[a-z][^>]*\son[a-z]+\s*=/gi) || [];
    ok(`${p}: keine Inline-Event-Handler im Markup`, inl.length === 0, inl.slice(0, 3));
    ok(`${p}: keine javascript:-URLs im Markup`, !/href\s*=\s*["']?javascript:/i.test(markup));
    ok(`${p}: keine on*="…"-Handler in HTML-Strings des Skripts`, !/\son(click|input|change|keydown|keyup|submit|load|error|mouse\w+|focus|blur|dblclick)="/.test(h));
  }
  ok('lernen-kern.js: keine on*="…"-Handler in HTML-Strings', !/\son(click|input|change|keydown|keyup|submit|load|error|mouse\w+|focus|blur|dblclick)="/.test(pub('lernen-kern.js')));
  ok('wizard.html/update.html: keine style="…"-Attribute (Tauri-Nonce auf style-src)', !/\sstyle="/.test(pub('wizard.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')) && !/\sstyle="/.test(pub('update.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')));
  ok('index.html: KaTeX/Mermaid/DOMPurify lokal referenziert, kein mermaid@10/katex@0.16.9-CDN mehr',
    idx.includes("'/vendor/katex/'") && idx.includes('/vendor/mermaid/mermaid.min.js') && idx.includes('/vendor/dompurify/purify.min.js') && !idx.includes('mermaid@10') && !idx.includes('katex@0.16.9'));
  ok("index.html: 'iframe' nicht mehr in RAW_HTML_TAGS", !/RAW_HTML_TAGS=new Set\(\[[^\]]*'iframe'/.test(idx));
  const tauri = JSON.parse(readFileSync(join(__dir, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'));
  ok('tauri.conf.json: csp gesetzt und identisch zu csp.js (CSP_POLICY_TAURI)', tauri.app.security.csp === CSP_POLICY_TAURI, tauri.app.security.csp);
  for (const d of ['dompurify', 'katex', 'mermaid', 'mammoth', 'pdfjs', 'fflate', 'cm6']) ok(`public/vendor/${d}/LICENSE vorhanden`, existsSync(join(__dir, '..', 'public', 'vendor', d, 'LICENSE')));
  for (const d of ['dompurify', 'katex', 'mermaid']) ok(`public/vendor/${d}/MANIFEST.tsv vorhanden`, existsSync(join(__dir, '..', 'public', 'vendor', d, 'MANIFEST.tsv')));
}

// ── Scratch ───────────────────────────────────────────────────────────────────
const PORT = 3988;
const TOKEN = 'ab'.repeat(32);
const scratch = mkdtempSync(join(tmpdir(), 'nexus sec test-'));
const vaultDir = join(scratch, 'test vault');
mkdirSync(join(vaultDir, 'Uni'), { recursive: true });
writeFileSync(join(vaultDir, 'Uni', 'Notiz.md'), '# Notiz\nInhalt.\n', 'utf8');
writeFileSync(join(vaultDir, 'Uni', 'Notiz.karten.json'), JSON.stringify({ version: 1, notiz: 'Uni/Notiz.md', karten: [] }), 'utf8');
writeFileSync(join(vaultDir, 'Uni', 'Seite.html'), '<html><body><script>localStorage.getItem("x")</script></body></html>', 'utf8');
writeFileSync(join(vaultDir, 'Uni', 'Grafik.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', 'utf8');
writeFileSync(join(vaultDir, 'Uni', 'Bild.png'), 'FAKE-PNG');
writeFileSync(join(vaultDir, 'Uni', 'Leiche.md.nexustmp'), 'halb geschrieben', 'utf8');
const outside = join(scratch, 'ausserhalb.md');
const cfgPath = join(scratch, 'nexus.config.json');
writeFileSync(cfgPath, JSON.stringify({
  vaultsRoot: scratch,
  activeVault: 'testvault',
  vaults: [{ name: 'testvault', path: vaultDir, dbPath: '.nexus/testvault.db' }],
  ui: { port: PORT, autoOpen: false },
  ignore: ['.obsidian', '.trash', '.nexus', 'node_modules'],
}, null, 2), 'utf8');

const base = `http://127.0.0.1:${PORT}`;
const V = 'testvault';
const H = { 'X-Nexus-Token': TOKEN };
const raw = async (p, opts = {}) => {
  const r = await fetch(base + p, { redirect: 'manual', ...opts });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, headers: Object.fromEntries(r.headers.entries()), text, json };
};
const get  = (p, extra = {}) => raw(p, { headers: { ...H, ...extra } });
const post = (p, body, extra = {}) => raw(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...H, ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) });

function startServer(extraEnv) {
  const srv = spawn(process.execPath, [UI_SERVER], {
    env: { ...process.env, NEXUS_DATA_DIR: scratch, NEXUS_PORT: String(PORT), NEXUS_DEV: '', NEXUS_SHELL: '', NEXUS_WEB: '', NEXUS_UI_TOKEN: TOKEN, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.log = '';
  srv.stdout.on('data', d => { srv.log += d; });
  srv.stderr.on('data', d => { srv.log += d; });
  return srv;
}
async function warten(headers = H) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(base + '/api/version', { headers }); if (r.ok) return true; } catch { /* noch nicht da */ }
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}
async function stop(srv) {
  if (!srv || srv.exitCode !== null) return;
  srv.kill();
  await new Promise(r => { srv.on('exit', r); setTimeout(r, 3000); });
  await new Promise(r => setTimeout(r, 300));
}
function lanIps() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}

let srv = null, exitCode = 1;
try {
  srv = startServer();
  ok('ui-server startet', await warten(), srv.log.slice(-400));
  // Zeit fuer den Startlog.
  await new Promise(r => setTimeout(r, 200));

  console.log('\n── 1. Bind-Adresse ──');
  ok('Startlog nennt 127.0.0.1', /lauscht auf 127\.0\.0\.1:/.test(srv.log), srv.log.slice(-300));
  ok('127.0.0.1 antwortet', (await get('/api/version')).status === 200);
  const lan = lanIps();
  if (lan.length) {
    let erreichbar = false;
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch(`http://${lan[0]}:${PORT}/api/version`, { signal: ctrl.signal });
      clearTimeout(t); erreichbar = r.status > 0;
    } catch { erreichbar = false; }
    ok(`LAN-IP ${lan[0]} ist NICHT erreichbar`, !erreichbar);
  } else {
    console.log('  (keine LAN-IP gefunden – Negativtest uebersprungen)');
  }

  console.log('\n── 2. UI-Token ──');
  ok('Token-Datei im DATA_DIR', existsSync(join(scratch, '.nexus', 'ui-token')) && readFileSync(join(scratch, '.nexus', 'ui-token'), 'utf8') === TOKEN);
  ok('GET /api/version ohne Token -> 200', (await raw('/api/version')).status === 200);
  const noTok = await raw('/api/vaults');
  ok('GET /api/vaults ohne Token -> 401', noTok.status === 401, noTok);
  ok('POST /api/save ohne Token -> 401', (await raw('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 401);
  ok('falscher Header -> 401', (await raw('/api/vaults', { headers: { 'X-Nexus-Token': 'ff'.repeat(32) } })).status === 401);
  ok('Header X-Nexus-Token -> 200', (await get('/api/vaults')).status === 200);
  const red = await raw('/?t=' + TOKEN);
  ok('?t=<token> -> 302 auf / ohne Query', red.status === 302 && red.headers.location === '/', red.headers);
  const sc = red.headers['set-cookie'] || '';
  ok('?t= setzt HttpOnly-Cookie', /nexus_ui=/.test(sc) && /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc), sc);
  const cookie = sc.split(';')[0];
  ok('Cookie allein reicht fuer /api/vaults', (await raw('/api/vaults', { headers: { Cookie: cookie } })).status === 200);
  const evH = await fetch(base + '/api/events', { headers: H });
  ok('/api/events per Header -> 401', evH.status === 401);
  const ctrl = new AbortController();
  const evC = await fetch(base + '/api/events', { headers: { Cookie: cookie }, signal: ctrl.signal });
  ok('/api/events per Cookie -> 200 (text/event-stream)', evC.status === 200 && /event-stream/.test(evC.headers.get('content-type') || ''));
  ctrl.abort();
  const bad = await raw('/?t=' + 'ff'.repeat(32));
  ok('falsches ?t= -> Redirect ohne Cookie', bad.status === 302 && !bad.headers['set-cookie'], bad.headers);
  ok('?t= auf /lernen.html -> 302 auf /lernen.html', (await raw('/lernen.html?t=' + TOKEN)).headers.location === '/lernen.html');

  console.log('\n── 3. Start-Aufraeumen + Config-Migration ──');
  ok('.nexustmp-Rest beim Start entfernt', !existsSync(join(vaultDir, 'Uni', 'Leiche.md.nexustmp')));
  const cfgNow = JSON.parse(readFileSync(cfgPath, 'utf8'));
  ok('nexus.config.json hat schemaVersion 1', cfgNow.schemaVersion === 1, cfgNow);
  const bakDir = join(scratch, '.nexus-backups');
  ok('Backup vor der Migration angelegt', existsSync(bakDir) && readdirSync(bakDir).some(f => /^nexus\.config\..*\.json$/.test(f)), existsSync(bakDir) ? readdirSync(bakDir) : 'kein Ordner');
  ok('kein .nexustmp neben der Config', !existsSync(cfgPath + '.nexustmp'));

  console.log('\n── 4. /api/save atomar + Pfad-Haertung ──');
  const s1 = await post('/api/save', { vault: V, path: 'Uni/Notiz.md', content: '# Notiz\nNeu.\n' });
  ok('save bestehende Notiz -> ok', s1.status === 200 && s1.json?.ok && s1.json.created === false, s1.json);
  ok('Inhalt auf Platte = gesendet', readFileSync(join(vaultDir, 'Uni', 'Notiz.md'), 'utf8') === '# Notiz\nNeu.\n');
  ok('kein .nexustmp-Rest', !existsSync(join(vaultDir, 'Uni', 'Notiz.md.nexustmp')));
  const s2 = await post('/api/save', { vault: V, path: 'Uni/Neu.txt', content: 'txt', create: true });
  ok('save neue .txt (create) -> ok', s2.status === 200 && s2.json?.created === true, s2.json);
  const s3 = await post('/api/save', { vault: V, path: 'Uni/Neu.txt', content: 'txt2' });
  ok('save bestehende .txt ohne create -> ok (Datei zaehlt als existent)', s3.status === 200 && readFileSync(join(vaultDir, 'Uni', 'Neu.txt'), 'utf8') === 'txt2', s3.json);
  ok('save neue Datei ohne create -> 404', (await post('/api/save', { vault: V, path: 'Uni/Nix.md', content: 'x' })).status === 404);
  for (const p of ['../ausserhalb.md', '..\\ausserhalb.md', outside, '\\\\?\\' + outside, 'Uni/../../ausserhalb.md']) {
    const r = await post('/api/save', { vault: V, path: p, content: 'boese', create: true });
    ok(`save ${JSON.stringify(p)} -> 400`, r.status === 400, r.json);
  }
  ok('nichts ausserhalb des Vaults geschrieben', !existsSync(outside) && !existsSync(join(vaultDir, 'ausserhalb.md')));
  ok('save mit path "" -> 400', (await post('/api/save', { vault: V, path: '', content: 'x', create: true })).status === 400);

  console.log('\n── 5. Body-Limit 413 ──');
  const big = await post('/api/save', { vault: V, path: 'Uni/Notiz.md', content: 'x'.repeat(2.5 * 1024 * 1024) });
  ok('2,5 MB Body -> 413 JSON', big.status === 413 && big.json?.error, big);
  const mid = await post('/api/save', { vault: V, path: 'Uni/Gross.md', content: 'y'.repeat(1.5 * 1024 * 1024), create: true });
  ok('1,5 MB Body -> 200 (Default 100 kB waere gescheitert)', mid.status === 200 && mid.json?.bytes === 1.5 * 1024 * 1024, mid.json);
  ok('ungueltiges JSON -> 400', (await post('/api/save', '{nope')).status === 400);

  console.log('\n── 6. /api/upload ──');
  const up = async (targetPath, name, bytes = 'data') => {
    const fd = new FormData();
    fd.append('vault', V);
    if (targetPath !== undefined) fd.append('targetPath', targetPath);
    fd.append('files', new Blob([bytes]), name);
    const r = await fetch(base + '/api/upload', { method: 'POST', headers: H, body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const u1 = await up('Uni', 'hoch.txt');
  ok('Upload in Uni/ -> ok', u1.status === 200 && u1.json?.files?.[0]?.path === 'Uni/hoch.txt' && existsSync(join(vaultDir, 'Uni', 'hoch.txt')), u1.json);
  const u2 = await up('../', 'boese.txt');
  ok('Upload targetPath ../ -> 400', u2.status === 400, u2.json);
  ok('nichts im Scratch neben dem Vault gelandet', !existsSync(join(scratch, 'boese.txt')));
  const u3 = await up('Uni', '../../boese2.txt');
  ok('Upload-Dateiname mit ../ -> auf Basename gekuerzt', u3.status === 200 && u3.json?.files?.[0]?.path === 'Uni/boese2.txt' && !existsSync(join(scratch, 'boese2.txt')), u3.json);
  const tmpLeft = readdirSync(join(scratch, '.nexus', 'tmp'));
  ok('Upload-Temp ist leer (Fehlerfall aufgeraeumt)', tmpLeft.length === 0, tmpLeft);

  console.log('\n── 7. /api/convert/markitdown Pfad-Haertung ──');
  const c1 = await post('/api/convert/markitdown', { vault: V, filePath: '../ausserhalb.docx' });
  ok('convert ../ -> 400', c1.status === 400, c1.json);
  ok('convert unbekannte Datei -> 404', (await post('/api/convert/markitdown', { vault: V, filePath: 'Uni/nix.docx' })).status === 404);

  console.log('\n── 8. /api/file: CSP sandbox ──');
  const f = (p) => get(`/api/file?vault=${V}&path=${encodeURIComponent(p)}`);
  const fh = await f('Uni/Seite.html');
  ok('.html -> CSP sandbox', fh.status === 200 && fh.headers['content-security-policy'] === 'sandbox', fh.headers);
  const fs_ = await f('Uni/Grafik.svg');
  ok('.svg -> CSP sandbox', fs_.status === 200 && fs_.headers['content-security-policy'] === 'sandbox', fs_.headers);
  // R27d (Review 2): Vorschau-Dokument mit eigener Policy + injizierten, geprueften Theme-Farben
  const pv = await get(`/api/file?vault=${V}&path=${encodeURIComponent('Uni/Seite.html')}&preview=1&bg=%23112233&tx=rgb(1,2,3)&dm=javascript:alert(1)`);
  ok('.html preview=1 -> CSP sandbox allow-scripts …', pv.status === 200 && pv.headers['content-security-policy'] === 'sandbox allow-scripts allow-popups allow-forms allow-modals', pv.headers);
  ok('.html preview=1 -> Theme-Style injiziert, ungueltige Farbe ersetzt', pv.text.includes('background:#112233') && pv.text.includes('color:rgb(1,2,3)') && !pv.text.includes('javascript:') && pv.text.includes('#7b8497'), pv.text.slice(0, 300));
  ok('.html preview=1 -> Originalinhalt bleibt (Skript unangetastet)', pv.text.includes('<script>localStorage.getItem("x")</script>'));
  ok('.svg mit preview=1 -> weiterhin nur sandbox', (await get(`/api/file?vault=${V}&path=${encodeURIComponent('Uni/Grafik.svg')}&preview=1`)).headers['content-security-policy'] === 'sandbox');
  const fp = await f('Uni/Bild.png');
  ok('.png -> keine CSP, image/png', fp.status === 200 && !fp.headers['content-security-policy'] && /image\/png/.test(fp.headers['content-type']), fp.headers);
  ok('.md -> keine CSP', !(await f('Uni/Notiz.md')).headers['content-security-policy']);
  ok('/api/file ../ -> 404', (await f('../nexus.config.json')).status === 404);

  console.log('\n── 9. Claude-Auth serverseitig ──');
  ok('GET /api/claude-auth: nicht konfiguriert', (await get('/api/claude-auth')).json?.configured === false);
  ok('Usage ohne Konfiguration -> 400', (await get('/api/claude-usage')).status === 400);
  const a1 = await post('/api/claude-auth', { sessionKey: 'sk-ant-geheim', orgId: 'org-1' });
  ok('POST /api/claude-auth -> ok', a1.status === 200 && a1.json?.configured === true && a1.json.orgId === 'org-1', a1.json);
  ok('Antwort enthaelt den Key nicht', !a1.text.includes('sk-ant-geheim'));
  const a2 = await get('/api/claude-auth');
  ok('GET zeigt konfiguriert + orgId, ohne Key', a2.json?.configured === true && a2.json.orgId === 'org-1' && !a2.text.includes('sk-ant'), a2.json);
  const af = join(scratch, '.nexus', 'claude-auth.json');
  ok('claude-auth.json im DATA_DIR mit Key', existsSync(af) && JSON.parse(readFileSync(af, 'utf8')).sessionKey === 'sk-ant-geheim');
  const a3 = await post('/api/claude-auth', { orgId: 'org-2' });
  ok('nur Org-ID aktualisieren (Key bleibt)', a3.status === 200 && JSON.parse(readFileSync(af, 'utf8')).sessionKey === 'sk-ant-geheim' && JSON.parse(readFileSync(af, 'utf8')).orgId === 'org-2', a3.json);
  ok('GET /api/claude-orgs gibt es nicht mehr (Key nie im Query)', (await get('/api/claude-orgs?sessionKey=x')).status === 404);
  const del = await raw('/api/claude-auth', { method: 'DELETE', headers: H });
  ok('DELETE /api/claude-auth -> entfernt', del.status === 200 && !existsSync(af), del.json);

  console.log('\n── 10. rename/delete/mkdir ueber tools.* ──');
  const m1 = await post('/api/mkdir', { vault: V, path: 'Uni/Neu' });
  ok('mkdir -> ok', m1.status === 200 && existsSync(join(vaultDir, 'Uni', 'Neu')), m1.json);
  ok('mkdir existiert -> 409', (await post('/api/mkdir', { vault: V, path: 'Uni/Neu' })).status === 409);
  ok('mkdir ../ -> 400', (await post('/api/mkdir', { vault: V, path: '../Boese' })).status === 400 && !existsSync(join(scratch, 'Boese')));
  const r1 = await post('/api/rename', { vault: V, oldPath: 'Uni/Notiz.md', newPath: 'Uni/Neu/Notiz2.md' });
  ok('rename -> ok', r1.status === 200 && existsSync(join(vaultDir, 'Uni', 'Neu', 'Notiz2.md')), r1.json);
  ok('rename nimmt Karten-Sidecar mit', existsSync(join(vaultDir, 'Uni', 'Neu', 'Notiz2.karten.json')) && !existsSync(join(vaultDir, 'Uni', 'Notiz.karten.json')));
  ok('rename Quelle fehlt -> 404', (await post('/api/rename', { vault: V, oldPath: 'Uni/nix.md', newPath: 'Uni/x.md' })).status === 404);
  ok('rename Ziel existiert -> 409', (await post('/api/rename', { vault: V, oldPath: 'Uni/Neu/Notiz2.md', newPath: 'Uni/Neu.txt' })).status === 409);
  ok('rename ../ -> 400', (await post('/api/rename', { vault: V, oldPath: 'Uni/Neu/Notiz2.md', newPath: '../weg.md' })).status === 400 && !existsSync(join(scratch, 'weg.md')));
  const d1 = await post('/api/delete', { vault: V, path: 'Uni/Neu/Notiz2.md' });
  ok('delete -> ok, Sidecar mit weg', d1.status === 200 && !existsSync(join(vaultDir, 'Uni', 'Neu', 'Notiz2.md')) && !existsSync(join(vaultDir, 'Uni', 'Neu', 'Notiz2.karten.json')), d1.json);
  ok('delete fehlt -> 404', (await post('/api/delete', { vault: V, path: 'Uni/Neu/Notiz2.md' })).status === 404);
  ok('delete Wurzel -> 400', (await post('/api/delete', { vault: V, path: '.' })).status === 400 && existsSync(vaultDir));
  ok('delete ../ -> 400', (await post('/api/delete', { vault: V, path: '../nexus.config.json' })).status === 400 && existsSync(cfgPath));

  console.log('\n── 10b. Papierkorb ueber die UI-API ──');
  writeFileSync(join(vaultDir, 'Uni', 'Weg.md'), '# Weg\n', 'utf8');
  writeFileSync(join(vaultDir, 'Uni', 'Weg.karten.json'), JSON.stringify({ version: 1, notiz: 'Uni/Weg.md', karten: [] }), 'utf8');
  const dw = await post('/api/delete', { vault: V, path: 'Uni/Weg.md' });
  ok('delete -> trashed-Pfad unter .trash/<stamp>/', dw.status === 200 && /^\.trash\/[^/]+\/Uni\/Weg\.md$/.test(dw.json?.trashed ?? ''), dw.json);
  ok('Datei + Sidecar im Papierkorb, Original weg', !existsSync(join(vaultDir, 'Uni', 'Weg.md')) && existsSync(join(vaultDir, dw.json.trashed)) && existsSync(join(vaultDir, dw.json.trashed.replace(/\.md$/, '.karten.json'))));
  ok('.trash bleibt im Dateibaum unsichtbar', !JSON.stringify((await get(`/api/tree?vault=${V}`)).json).includes('.trash'));
  const tl = await get(`/api/trash?vault=${V}`);
  // (Notiz2.md aus Abschnitt 10 liegt ebenfalls im Papierkorb – deshalb per trashPath suchen, nicht [0].)
  ok('GET /api/trash listet den Eintrag + retentionDays', tl.status === 200 && tl.json?.gesamt >= 1 && tl.json.eintraege.some(e => e.trashPath === dw.json.trashed && e.path === 'Uni/Weg.md') && tl.json.retentionDays === 30, tl.json);
  ok('delete _System -> 400 (geschuetzt)', (mkdirSync(join(vaultDir, '_System'), { recursive: true }), (await post('/api/delete', { vault: V, path: '_System' })).status === 400) && existsSync(join(vaultDir, '_System')));
  ok('POST /api/trash/delete ausserhalb .trash -> 400', (await post('/api/trash/delete', { vault: V, path: 'Uni/Neu.txt' })).status === 400 && existsSync(join(vaultDir, 'Uni', 'Neu.txt')));
  const rs = await post('/api/trash/restore', { vault: V, path: dw.json.trashed });
  ok('POST /api/trash/restore -> Notiz + Sidecar zurueck', rs.status === 200 && rs.json?.ok && existsSync(join(vaultDir, 'Uni', 'Weg.md')) && existsSync(join(vaultDir, 'Uni', 'Weg.karten.json')), rs.json);
  ok('restore erneut -> 404 (nicht mehr im Papierkorb)', (await post('/api/trash/restore', { vault: V, path: dw.json.trashed })).status === 404);
  const dw2 = await post('/api/delete', { vault: V, path: 'Uni/Weg.md' });
  writeFileSync(join(vaultDir, 'Uni', 'Weg.md'), '# Neu an der Stelle\n', 'utf8');
  ok('restore bei Konflikt -> 409, nichts ueberschrieben', (await post('/api/trash/restore', { vault: V, path: dw2.json.trashed })).status === 409 && readFileSync(join(vaultDir, 'Uni', 'Weg.md'), 'utf8').includes('Neu an der Stelle'));
  const pd = await post('/api/trash/delete', { vault: V, path: dw2.json.trashed });
  ok('POST /api/trash/delete (permanent) -> weg', pd.status === 200 && pd.json?.permanent === true && !existsSync(join(vaultDir, dw2.json.trashed)), pd.json);
  // Aufraeumen beim Start: ein 40 Tage alter Stempel-Ordner muss nach einem Neustart verschwinden (Test 11 startet neu).
  mkdirSync(join(vaultDir, '.trash', '2020-01-01_120000', 'Alt'), { recursive: true });
  writeFileSync(join(vaultDir, '.trash', '2020-01-01_120000', 'Alt', 'uralt.md'), '# uralt\n', 'utf8');

  console.log('\n── 10c. Content-Security-Policy-Header + MCP-Status (R27c) ──');
  {
    const pub = (p) => readFileSync(join(__dir, '..', 'public', p), 'utf8');
    const r = await raw('/');
    ok('GET / -> 200 mit CSP-Header', r.status === 200 && !!r.headers['content-security-policy'], r.headers);
    ok('CSP-Header von / == buildCsp(index.html)', r.headers['content-security-policy'] === buildCsp(pub('index.html')));
    for (const p of ['lernen.html', 'help.html', 'wizard.html', 'update.html']) {
      const q = await raw('/' + p);
      ok(`GET /${p} -> CSP-Header mit eigenen Hashes`, q.status === 200 && q.headers['content-security-policy'] === buildCsp(pub(p)), q.headers['content-security-policy']);
    }
    ok('Nicht-HTML (katex.min.css) ohne CSP-Header', (await raw('/vendor/katex/katex.min.css')).status === 200 && !(await raw('/vendor/katex/katex.min.css')).headers['content-security-policy']);
    for (const v of ['/vendor/katex/katex.min.js', '/vendor/katex/fonts/KaTeX_Main-Regular.woff2', '/vendor/mermaid/mermaid.min.js', '/vendor/dompurify/purify.min.js'])
      ok(`${v} erreichbar`, (await raw(v)).status === 200);
    const st = await get('/api/connect-claude/status');
    ok('GET /api/connect-claude/status -> {configured:boolean, key:"nexus"} (Nur-Lese)', st.status === 200 && st.json && typeof st.json.configured === 'boolean' && st.json.key === 'nexus', st.json);
    ok('GET /api/connect-claude/status ohne Token -> 401', (await raw('/api/connect-claude/status')).status === 401);
  }

  await stop(srv);

  console.log('\n── 11. Web-Betrieb (NEXUS_WEB=1): kein Token, gesperrte Routen ──');
  srv = startServer({ NEXUS_WEB: '1', NEXUS_UI_TOKEN: '' });
  ok('ui-server (Web) startet', await warten({}), srv.log.slice(-400));
  await new Promise(r => setTimeout(r, 200));
  {
    const q = await raw('/lernen.html');
    ok('Web: /lernen.html traegt denselben CSP-Header', q.status === 200 && q.headers['content-security-policy'] === buildCsp(readFileSync(join(__dir, '..', 'public', 'lernen.html'), 'utf8')), q.headers['content-security-policy']);
    ok('Web: /api/connect-claude/status -> 403 (geraetegebunden)', (await raw('/api/connect-claude/status')).status === 403);
  }
  ok('Papierkorb-Eintrag aelter als 30 Tage beim Start entfernt', !existsSync(join(vaultDir, '.trash', '2020-01-01_120000')) && /Papierkorb-Eintrag/.test(srv.log), srv.log.slice(-300));
  ok('Startlog nennt 0.0.0.0 + "kein UI-Token"', /lauscht auf 0\.0\.0\.0:.*kein UI-Token/.test(srv.log), srv.log.slice(-300));
  ok('/api/vaults ohne Token -> 200 (Auth macht der Proxy)', (await raw('/api/vaults')).status === 200);
  ok('/api/lernen/uebersicht ohne Token -> 200 (lernen.html)', (await raw(`/api/lernen/uebersicht?vault=${V}`)).status === 200);
  ok('/api/claude-auth im Web -> 403', (await raw('/api/claude-auth')).status === 403);
  ok('/api/claude-usage im Web -> 403', (await raw('/api/claude-usage')).status === 403);
  ok('/api/open-external im Web -> 403', (await raw('/api/open-external', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
  ok('?t= im Web ist wirkungslos (kein Redirect)', (await raw('/lernen.html?t=abc')).status === 200);
  await stop(srv);

  exitCode = fail ? 1 : 0;
} catch (e) {
  console.error('Testlauf abgebrochen:', e);
  console.error(srv?.log?.slice(-800));
} finally {
  await stop(srv);
  try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
}
console.log(`\n${pass} bestanden, ${fail} Fehler`);
process.exit(exitCode);
