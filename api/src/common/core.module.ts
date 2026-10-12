import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfig, CONFIG, loadConfig } from '../config/config';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { CacheService } from '../redis/cache.service';
import { RabbitService } from '../mq/rabbit.service';
import { OutboxService } from './outbox.service';
import { AdminGuard, AuthGuard, IpRateLimitGuard, TokenService, UserRateLimitGuard } from './auth';

@Global()
@Module({})
export class CoreModule {
  static forRoot(overrides: Partial<AppConfig> = {}): DynamicModule {
    const providers = [
      { provide: CONFIG, useValue: { ...loadConfig(), ...overrides } as AppConfig },
      DbService, RedisService, CacheService, RabbitService, OutboxService,
      TokenService, AuthGuard, AdminGuard, UserRateLimitGuard,
      { provide: APP_GUARD, useClass: IpRateLimitGuard },
    ];
    return {
      module: CoreModule,
      global: true,
      providers,
      exports: [CONFIG, DbService, RedisService, CacheService, RabbitService, OutboxService, TokenService, AuthGuard, AdminGuard, UserRateLimitGuard],
    };
  }
}
