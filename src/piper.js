// src/piper.js – R24b: lokale Neural-TTS (Piper) fuer den Vortrag-Button.
//
// Bewusst OHNE Electron-Imports (reines Node/ESM): so ist das Modul headless
// testbar (node -e) und wird seit Phase 1 direkt vom UI-Server genutzt (REST
// statt Electron-IPC, siehe src/ui-server.js).
// Aufgaben: Engine + Stimmen herunterladen (nutzerinitiiert, mit Fortschritt),
// verwalten, und Text -> WAV synthetisieren (piper.exe, Text via stdin).
//
// Ablage: <DATA_DIR>/.nexus/piper/  (dev: D:\Nexus\.nexus\piper, gepackt: userData)
//   piper/            entpackte Engine (piper.exe, onnxruntime, espeak-ng-data)
//   voices/<id>.onnx(+.json)   installierte Stimmen
//   tmp/              Download-/Synthese-Zwischendateien
import { existsSync, mkdirSync, createWriteStream, readFileSync, rmSync, readdirSync, renameSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { spawn, spawnSync } from 'child_process';
import { DATA_DIR } from './paths.js';

export const PIPER_DIR = join(DATA_DIR, '.nexus', 'piper');
const ENGINE_DIR = join(PIPER_DIR, 'piper');
const VOICES_DIR = join(PIPER_DIR, 'voices');
const TMP_DIR = join(PIPER_DIR, 'tmp');
const EXE = join(ENGINE_DIR, 'piper.exe');

// Engine-Release (rhasspy/piper, MIT) – Windows x64 inkl. onnxruntime + espeak-ng-data.
const ENGINE_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

// Kuratierte deutsche Stimmen aus rhasspy/piper-voices (Hugging Face, MIT/frei).
// groesseMB nur fuer die Anzeige (circa); die echte Groesse liefert Content-Length.
export const PIPER_VOICES = {
  'de_DE-thorsten-high':   { name: 'Thorsten (hoch)',   groesseMB: 110, base: 'de/de_DE/thorsten/high/de_DE-thorsten-high' },
  'de_DE-thorsten-medium': { name: 'Thorsten (mittel)', groesseMB: 75,  base: 'de/de_DE/thorsten/medium/de_DE-thorsten-medium' },
  'de_DE-kerstin-low':     { name: 'Kerstin (leicht)',  groesseMB: 60,  base: 'de/de_DE/kerstin/low/de_DE-kerstin-low' },
  'de_DE-eva_k-x_low':     { name: 'Eva K (mini)',      groesseMB: 25,  base: 'de/de_DE/eva_k/x_low/de_DE-eva_k-x_low' },
};
const voiceUrl = (base, ext) =>
  `https://huggingface.co/rhasspy/piper-voices/resolve/main/${base}${ext}?download=true`;

function ensureDirs() { for (const d of [PIPER_DIR, VOICES_DIR, TMP_DIR]) mkdirSync(d, { recursive: true }); }

// ── Status ────────────────────────────────────────────────────────────────────
export function piperStatus() {
  let voices = [];
  try {
    voices = readdirSync(VOICES_DIR)
      .filter(f => f.endsWith('.onnx') && existsSync(join(VOICES_DIR, f + '.json')))
      .map(f => f.replace(/\.onnx$/, ''));
  } catch {}
  return { engine: existsSync(EXE), voices, dir: PIPER_DIR, katalog: PIPER_VOICES };
}

// ── Download (fetch folgt Redirects; HF leitet auf CDN um) ───────────────────
async function download(url, dest, onProgress, label) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  ensureDirs();
  const tmp = dest + '.part';
  const out = createWriteStream(tmp);
  let received = 0, lastTick = 0;
  for await (const chunk of res.body) {
    received += chunk.length;
    if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
    const now = Date.now();
    if (onProgress && now - lastTick > 250) { lastTick = now; onProgress({ label, received, total }); }
  }
  await new Promise((r, j) => out.end(err => err ? j(err) : r()));
  if (total && received < total) { try { rmSync(tmp, { force: true }); } catch {}; throw new Error(`Download unvollstaendig: ${label} (${received}/${total} Bytes)`); }
  renameSync(tmp, dest);
  if (onProgress) onProgress({ label, received, total: total || received, fertig: true });
}

// ── Engine installieren (einmalig, automatisch mit der ersten Stimme) ────────
async function ensureEngine(onProgress) {
  if (existsSync(EXE)) return;
  ensureDirs();
  const zip = join(TMP_DIR, 'piper_windows_amd64.zip');
  await download(ENGINE_URL, zip, onProgress, 'Engine (piper.exe)');
  // Entpacken ohne neue Dependency: PowerShell Expand-Archive (Windows-Bordmittel).
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -LiteralPath "${zip}" -DestinationPath "${PIPER_DIR}" -Force`], { stdio: 'pipe' });
  if (r.status !== 0) throw new Error('Entpacken fehlgeschlagen: ' + String(r.stderr || r.stdout || '').slice(0, 300));
  try { rmSync(zip, { force: true }); } catch {}
  if (!existsSync(EXE)) throw new Error('piper.exe nach dem Entpacken nicht gefunden unter ' + EXE);
}

// ── Stimme installieren/loeschen ─────────────────────────────────────────────
export async function piperInstallVoice(id, onProgress) {
  const v = PIPER_VOICES[id];
  if (!v) return { error: 'Unbekannte Stimme: ' + id + ' (verfuegbar: ' + Object.keys(PIPER_VOICES).join(', ') + ')' };
  try {
    await ensureEngine(onProgress);
    const onnx = join(VOICES_DIR, id + '.onnx');
    const json = join(VOICES_DIR, id + '.onnx.json');
    if (!existsSync(json)) await download(voiceUrl(v.base, '.onnx.json'), json, onProgress, v.name + ' (Konfiguration)');
    if (!existsSync(onnx)) await download(voiceUrl(v.base, '.onnx'), onnx, onProgress, v.name + ' (Stimmmodell)');
    return { ok: true, ...piperStatus() };
  } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
}

export function piperDeleteVoice(id) {
  try {
    rmSync(join(VOICES_DIR, id + '.onnx'), { force: true });
    rmSync(join(VOICES_DIR, id + '.onnx.json'), { force: true });
    return { ok: true, ...piperStatus() };
  } catch (e) { return { error: String(e && e.message ? e.message : e) }; }
}

// ── Synthese: Text -> WAV-Buffer ─────────────────────────────────────────────
// lengthScale steuert das Tempo (1/rate): 0.7 = schneller, 1.4 = langsamer.
let synthSeq = 0;
export async function piperSynth(text, { voice, lengthScale = 1 } = {}) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Kein Text' };
  if (!existsSync(EXE)) return { error: 'Piper-Engine nicht installiert' };
  const onnx = join(VOICES_DIR, String(voice || '') + '.onnx');
  if (!voice || !existsSync(onnx)) return { error: 'Stimme nicht installiert: ' + voice };
  ensureDirs();
  const out = join(TMP_DIR, `synth-${process.pid}-${++synthSeq}.wav`);
  const ls = Math.max(0.5, Math.min(2, Number(lengthScale) || 1));
  const args = ['--model', onnx, '--config', onnx + '.json', '--output_file', out, '--length_scale', String(ls)];
  const okExit = await new Promise(resolve => {
    // cwd = Engine-Ordner, damit piper.exe espeak-ng-data relativ findet.
    const child = spawn(EXE, args, { cwd: ENGINE_DIR, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', () => resolve({ ok: false, err: 'Start fehlgeschlagen' }));
    child.on('close', code => resolve({ ok: code === 0, err }));
    child.stdin.end(t, 'utf8');
  });
  if (!okExit.ok || !existsSync(out)) {
    try { rmSync(out, { force: true }); } catch {}
    return { error: 'Synthese fehlgeschlagen: ' + String(okExit.err || '').slice(-300) };
  }
  const wav = readFileSync(out);
  try { rmSync(out, { force: true }); } catch {}
  return { ok: true, wavBase64: wav.toString('base64'), bytes: wav.length };
}
