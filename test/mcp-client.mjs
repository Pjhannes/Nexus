// test/mcp-client.mjs – Mini-MCP-Client fuer die E2E-Tests (JSON-RPC ueber stdio,
// eine Nachricht pro Zeile – exakt das Transport-Format des SDK-StdioServers).
// Geteilt von mcp-launch.test.mjs (Repo-Baum) und mcp-packaged.test.mjs
// (gepacktes resources-Layout).
//
// Robust gegen Spawn-Fehler (AV blockt eine frisch kopierte node.exe) und
// Server-Crash: 'error'/'exit' rejecten alle offenen Requests sofort statt in
// den Timeout zu laufen oder als unbehandeltes Event den Test zu killen.
import { spawn } from 'child_process';

export function mcpSession(command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = new Map();
  let stderrTail = '';
  let dead = null;
  const failAll = (err) => {
    dead = err;
    for (const [, entry] of pending) { clearTimeout(entry.t); entry.reject(err); }
    pending.clear();
  };
  child.on('error', (e) => failAll(new Error(`Spawn fehlgeschlagen: ${e.message}`)));
  child.on('exit', (code, sig) => {
    if (pending.size) failAll(new Error(`Server-Exit (code ${code}, signal ${sig}). stderr: ${stderrTail.slice(-500)}`));
  });
  child.stderr.on('data', d => { stderrTail = (stderrTail + d.toString()).slice(-3000); });
  child.stdout.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id);
        clearTimeout(entry.t); pending.delete(msg.id); entry.resolve(msg);
      }
    }
  });
  let seq = 0;
  function request(method, params, timeoutMs = 20_000) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      if (dead) return reject(dead);
      const t = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout bei ${method}. stderr: ${stderrTail.slice(-400)}`)); }, timeoutMs);
      pending.set(id, { resolve, reject, t });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  function notify(method, params) {
    try { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); } catch {}
  }
  const exited = new Promise(r => child.once('exit', r));
  return { child, request, notify, exited, getStderr: () => stderrTail };
}

// Tool-Antwort -> geparstes JSON (die Nexus-Tools liefern JSON-Text im content).
export function toolJson(msg) {
  const text = (msg.result?.content ?? []).map(c => c.text).join('');
  try { return JSON.parse(text); } catch { return { __raw: text }; }
}
