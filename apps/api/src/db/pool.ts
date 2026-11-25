import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createPgPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export async function runMigrations(pool: Pool): Promise<void> {
  const localDir = path.join(__dirname, 'migrations');
  const srcFallbackDir = path.resolve(__dirname, '../../src/db/migrations');
  const migrationDir = existsSync(localDir) ? localDir : srcFallbackDir;
  const files = readdirSync(migrationDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No migration files found in ${migrationDir}`);
  }
  for (const file of files) {
    const sql = await readFile(path.join(migrationDir, file), 'utf8');
    await pool.query(sql);
  }
}
