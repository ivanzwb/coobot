import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import path from 'path';
import fs from 'fs';

const dbPath = process.env.DB_PATH || './data/biosbot.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_import_history (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    mime_type TEXT,
    agent_id TEXT,
    status TEXT NOT NULL DEFAULT 'processing',
    message TEXT,
    document_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (document_id) REFERENCES knowledge_documents(id)
  );
`);

export const db = drizzle(sqlite, { schema });

export const closeDb = () => {
  sqlite.close();
};

export default db;