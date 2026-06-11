// src/cli.js – manueller Reindex
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildIndexer } from './indexer.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const cfg   = JSON.parse(readFileSync(join(__dir, '..', 'nexus.config.json'), 'utf8'));
const cmd   = process.argv[2];

if (cmd === 'reindex') {
  for (const v of cfg.vaults) {
    console.log(`Reindexing vault: ${v.name} (${v.path})`);
    const idx = buildIndexer(v.path, v.dbPath, cfg.ignore ?? []);
    const n   = idx.reindex();
    console.log(`  → ${n} Dateien indexiert`);
  }
} else {
  console.log('Usage: node src/cli.js reindex');
}
