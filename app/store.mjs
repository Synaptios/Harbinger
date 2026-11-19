import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS saves (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      revision INTEGER NOT NULL,
      state TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS committed_turns (
      save_id TEXT NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      prior_revision INTEGER NOT NULL,
      input TEXT NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (save_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS save_notes (
      save_id TEXT PRIMARY KEY REFERENCES saves(id) ON DELETE CASCADE,
      note TEXT NOT NULL
    );
  `);
  const find = db.prepare('SELECT * FROM saves WHERE id = ?');

  return {
    get(id) {
      const row = find.get(id);
      return row && { ...row, state: JSON.parse(row.state) };
    },
    list() {
      return db.prepare('SELECT id, name, revision, updated_at FROM saves ORDER BY updated_at DESC').all();
    },
    create(name, state, revision = 0, note = '') {
      const id = randomUUID();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT INTO saves VALUES (?, ?, ?, ?, ?)').run(
          id, name, revision, JSON.stringify(state), new Date().toISOString(),
        );
        if (note) this.setNote(id, note);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return this.get(id);
    },
    getNote(id) {
      return db.prepare('SELECT note FROM save_notes WHERE save_id = ?').get(id)?.note ?? '';
    },
    setNote(id, note) {
      db.prepare(`
        INSERT INTO save_notes VALUES (?, ?)
        ON CONFLICT(save_id) DO UPDATE SET note = excluded.note
      `).run(id, note);
    },
    receipt(id, requestId) {
      const row = db.prepare(`
        SELECT committed_turns.*, saves.name
        FROM committed_turns JOIN saves ON saves.id = committed_turns.save_id
        WHERE save_id = ? AND request_id = ?
      `).get(id, requestId);
      if (!row) return undefined;
      return { input: row.input, id, name: row.name, revision: row.prior_revision + 1, state: JSON.parse(row.state) };
    },
    commit(id, revision, state, request) {
      const encoded = JSON.stringify(state);
      db.exec('BEGIN IMMEDIATE');
      try {
        const update = db.prepare(`
          UPDATE saves SET revision = revision + 1, state = ?, updated_at = ?
          WHERE id = ? AND revision = ?
        `).run(encoded, new Date().toISOString(), id, revision);
        if (update.changes === 0) {
          db.exec('ROLLBACK');
          return undefined;
        }
        db.prepare('INSERT INTO committed_turns VALUES (?, ?, ?, ?, ?)').run(id, request.requestId, revision, request.text, encoded);
        db.exec('COMMIT');
        return this.get(id);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
