// src/db.js – SQLite schema + connection via eingebautes node:sqlite (Node >=22.5)
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

// Diesen Wert erhoehen wenn sich das Schema aendert.
// Beim Mismatch wird die DB komplett geloescht + neu aufgebaut –
// notwendig weil CREATE VIRTUAL TABLE IF NOT EXISTS veraltete FTS5-Schemata nicht aktualisiert.
const SCHEMA_VERSION = 3;

export function openDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');

  // Schema-Versionspruefung
  const ver = db.prepare('PRAGMA user_version').get();
  if (ver.user_version !== SCHEMA_VERSION) {
    // DDL ignoriert PRAGMA foreign_keys – Reihenfolge beim DROP unkritisch
    db.exec(`
      DROP TABLE IF EXISTS links;
      DROP TABLE IF EXISTS headings;
      DROP TABLE IF EXISTS notes;
      DROP TABLE IF EXISTS notes_fts;
    `);
  }

  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id       INTEGER PRIMARY KEY,
      path     TEXT    NOT NULL UNIQUE,
      title    TEXT,
      mtime    INTEGER NOT NULL,
      size     INTEGER NOT NULL,
      tags     TEXT    DEFAULT '[]',
      frontmatter TEXT DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS headings (
      id       INTEGER PRIMARY KEY,
      note_id  INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      level    INTEGER NOT NULL,
      text     TEXT    NOT NULL,
      line     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS links (
      id       INTEGER PRIMARY KEY,
      src_id   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target   TEXT    NOT NULL,
      alias    TEXT,
      line     INTEGER
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      path, title, body,
      tokenize='unicode61'
    );
  `);

  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

// Hilfsfunktion: einfache Transaktion
export function transaction(db, fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
