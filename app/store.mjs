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
    create(name, state, revision = 0) {
      const id = randomUUID();
      db.prepare('INSERT INTO saves VALUES (?, ?, ?, ?, ?)').run(
        id, name, revision, JSON.stringify(state), new Date().toISOString(),
      );
      return this.get(id);
    },
    commit(id, revision, state) {
      const update = db.prepare(`
        UPDATE saves SET revision = revision + 1, state = ?, updated_at = ?
        WHERE id = ? AND revision = ?
      `).run(JSON.stringify(state), new Date().toISOString(), id, revision);
      return update.changes === 1 ? this.get(id) : undefined;
    },
    close() {
      db.close();
    },
  };
}
