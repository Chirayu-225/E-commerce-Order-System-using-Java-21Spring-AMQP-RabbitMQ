export const CONFIG = Symbol('CONFIG');

export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  dbPoolMax: number;
  redisUrl: string;
  redisPrefix: string;
  rabbitUrl: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  corsOrigins: string[];
  webhookSecret: string;
  gatewaySimulator: boolean;
  /** How long an unpaid order holds its stock. */
  orderTtlMs: number;
  /** Simulated warehouse delays between PAID -> PACKED -> SHIPPED -> DELIVERED. */
  fulfilmentDelaysMs: { pack: number; ship: number; deliver: number };
  seedDemo: boolean;
  migrateOnStart: boolean;
  /** Run background workers (outbox relay, queue consumers, expiry sweeper) inside the API process. */
  runWorkers: boolean;
  /** Redis stock gate in front of Postgres. Postgres alone is still correct when this is off. */
  gateEnabled: boolean;
  cacheTtlSec: number;
  rateLimit: {
    enabled: boolean;
    ipBurst: number;
    ipPerSec: number;
    checkoutBurst: number;
    checkoutPerSec: number;
  };
}

const num = (v: string | undefined, d: number): number => {
  if (v === undefined || v.trim() === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | undefined, d: boolean): boolean =>
  v === undefined || v.trim() === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const jwtSecret = env.JWT_SECRET ?? 'dev-only-secret-change-me-before-deploying-32+';
  const webhookSecret = env.WEBHOOK_SECRET ?? 'dev-only-webhook-secret-change-me';
  if (nodeEnv === 'production') {
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be set (32+ characters) in production');
    if (!env.WEBHOOK_SECRET || env.WEBHOOK_SECRET.length < 16) throw new Error('WEBHOOK_SECRET must be set in production');
  }
  return {
    nodeEnv,
    port: num(env.PORT, 8080),
    databaseUrl: env.DATABASE_URL ?? 'postgres://flashcart:flashcart@127.0.0.1:5432/flashcart',
    dbPoolMax: num(env.DB_POOL_MAX, 20),
    redisUrl: env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    redisPrefix: env.REDIS_PREFIX ?? 'fc:',
    rabbitUrl: env.RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672',
    jwtSecret,
    jwtTtlSeconds: num(env.JWT_TTL_HOURS, 24) * 3600,
    corsOrigins: (env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    webhookSecret,
    gatewaySimulator: bool(env.GATEWAY_SIMULATOR, true),
    orderTtlMs: num(env.ORDER_TTL_SECONDS, 600) * 1000,
    fulfilmentDelaysMs: {
      pack: num(env.FULFIL_PACK_SECONDS, 15) * 1000,
      ship: num(env.FULFIL_SHIP_SECONDS, 20) * 1000,
      deliver: num(env.FULFIL_DELIVER_SECONDS, 30) * 1000,
    },
    seedDemo: bool(env.SEED_DEMO, true),
    migrateOnStart: bool(env.MIGRATE_ON_START, true),
    runWorkers: bool(env.RUN_WORKERS, true),
    gateEnabled: bool(env.REDIS_GATE_ENABLED, true),
    cacheTtlSec: num(env.CACHE_TTL_SECONDS, 30),
    rateLimit: {
      enabled: bool(env.RATE_LIMIT_ENABLED, true),
      ipBurst: num(env.RATE_LIMIT_IP_BURST, 300),
      ipPerSec: num(env.RATE_LIMIT_IP_PER_SEC, 100),
      checkoutBurst: num(env.RATE_LIMIT_CHECKOUT_BURST, 5),
      checkoutPerSec: num(env.RATE_LIMIT_CHECKOUT_PER_SEC, 0.5),
    },
  };
}
