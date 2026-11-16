import { existsSync } from 'node:fs';
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
  const localPath = path.join(__dirname, 'migrations', '001_init.sql');
  const srcFallbackPath = path.resolve(__dirname, '../../src/db/migrations', '001_init.sql');
  const migrationPath = existsSync(localPath) ? localPath : srcFallbackPath;
  const sql = await readFile(migrationPath, 'utf8');
  await pool.query(sql);
}
