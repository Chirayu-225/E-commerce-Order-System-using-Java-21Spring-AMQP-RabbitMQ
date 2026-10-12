import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

/** Minimal forward-only migration runner: ordered .sql files, each in its own transaction, tracked in schema_migrations. */
export async function runMigrations(pool: Pool, log: (m: string) => void = () => undefined): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727274)'); // several instances may boot at once; only one migrates
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set((await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const dir = join(__dirname, 'migrations');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        log(`applied migration ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
    return applied;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(727274)'); } catch { /* ignore */ }
    client.release();
  }
}
