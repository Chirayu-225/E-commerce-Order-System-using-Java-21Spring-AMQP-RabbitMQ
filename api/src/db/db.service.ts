import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client, Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { AppConfig, CONFIG } from '../config/config';
import { runMigrations } from './migrate';

/** Anything we can run SQL on: the pool or a transaction's client. */
export type Db = Pick<PoolClient, 'query'>;
export type Effect = () => Promise<void> | void;
export type Isolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Db');
  readonly pool: Pool;
  private listeners: Array<() => Promise<void>> = [];

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.pool = new Pool({
      connectionString: cfg.databaseUrl,
      max: cfg.dbPoolMax,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    this.pool.on('error', (e) => this.log.error(`idle client error: ${e.message}`));
  }

  async onModuleInit(): Promise<void> {
    if (this.cfg.migrateOnStart) await runMigrations(this.pool, (m) => this.log.log(m));
  }

  query<T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as any[]);
  }

  /**
   * Run `fn` in one transaction.  Side effects that must only happen if the transaction commits
   * (Redis publishes, cache invalidation) are registered with `defer` and run after COMMIT.
   * Deadlocks (40P01) and serialization failures (40001) are retried: Postgres picked a loser, the work is safe to redo.
   */
  async tx<T>(
    fn: (c: PoolClient, defer: (e: Effect) => void) => Promise<T>,
    opts: { isolation?: Isolation; retries?: number } = {},
  ): Promise<T> {
    const retries = opts.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const client = await this.pool.connect();
      const effects: Effect[] = [];
      try {
        await client.query(opts.isolation ? `BEGIN ISOLATION LEVEL ${opts.isolation}` : 'BEGIN');
        const result = await fn(client, (e) => effects.push(e));
        await client.query('COMMIT');
        client.release();
        for (const e of effects) {
          try { await e(); } catch (err) { this.log.warn(`post-commit effect failed: ${(err as Error).message}`); }
        }
        return result;
      } catch (e) {
        try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
        client.release();
        const code = (e as { code?: string }).code;
        if ((code === '40P01' || code === '40001') && attempt < retries) {
          await new Promise((r) => setTimeout(r, 10 + Math.random() * 30 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
  }

  /** LISTEN on a Postgres channel with automatic reconnect.  Returns a stop function. */
  async listen(channel: string, onNotify: () => void): Promise<() => Promise<void>> {
    let stopped = false;
    let client: Client | undefined;
    const connect = async (): Promise<void> => {
      if (stopped) return;
      try {
        client = new Client({ connectionString: this.cfg.databaseUrl });
        client.on('error', () => undefined);
        client.on('notification', () => onNotify());
        client.on('end', () => { if (!stopped) setTimeout(() => void connect(), 2000); });
        await client.connect();
        await client.query(`LISTEN ${channel}`);
      } catch (e) {
        this.log.warn(`LISTEN ${channel} failed: ${(e as Error).message}; retrying`);
        if (!stopped) setTimeout(() => void connect(), 2000);
      }
    };
    await connect();
    const stop = async () => { stopped = true; try { await client?.end(); } catch { /* ignore */ } };
    this.listeners.push(stop);
    return stop;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.listeners.map((s) => s()));
    await this.pool.end();
  }
}
