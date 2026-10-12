import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { LogLevel } from '@nestjs/common';
import { AppModule } from './app.module';
import { AppConfig, loadConfig } from './config/config';

export async function createApp(overrides: Partial<AppConfig> = {}, opts: { logger?: LogLevel[] | false } = {}): Promise<NestFastifyApplication> {
  const cfg = { ...loadConfig(), ...overrides };
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(overrides),
    new FastifyAdapter({ trustProxy: true, bodyLimit: 256 * 1024 }),
    { rawBody: true, logger: opts.logger ?? ['log', 'warn', 'error'] },
  );
  await app.register(helmet as any, { contentSecurityPolicy: false });
  await app.register(cors as any, {
    origin: cfg.corsOrigins.includes('*') ? true : cfg.corsOrigins,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Retry-After', 'Idempotent-Replayed'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });
  app.enableShutdownHooks();
  return app;
}
