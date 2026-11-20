// src/server.js – MCP-Einstieg ueber stdio (Claude Desktop / Cowork / Claude Code).
// Nur Transport: die Tools baut src/mcp/build-server.js, Registry/Identitaet src/mcp/runtime.js.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './mcp/build-server.js';
import { serverInfo, createRegistry, cleanupTrash } from './mcp/runtime.js';

const info = serverInfo();
console.error(`[Nexus] MCP-Server v${info.version}${info.gitCommit ? ' (' + info.gitCommit + ')' : ''}, Daten: ${info.dataDir}`);
const registry = createRegistry();
cleanupTrash(registry);

await buildServer({ registry, info }).connect(new StdioServerTransport());
