import { Pool } from 'pg';
import { loadConfig } from '../config/config';
import { runMigrations } from './migrate';

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: loadConfig().databaseUrl });
  const applied = await runMigrations(pool, (m) => console.log(m));
  console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
