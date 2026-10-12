import { Controller, Get, HttpException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.service';
import { RabbitService } from '../mq/rabbit.service';
import { SkipRateLimit } from '../common/auth';

@Controller('api/health')
@SkipRateLimit()
export class HealthController {
  constructor(private readonly db: DbService, private readonly redis: RedisService, private readonly rabbit: RabbitService) {}

  /** 503 only when Postgres is down (the one dependency the API cannot work without); Redis/RabbitMQ degrade gracefully. */
  @Get()
  async health() {
    let dbOk = true;
    try { await this.db.query('SELECT 1'); } catch { dbOk = false; }
    const body = { status: dbOk ? 'ok' : 'down', db: dbOk, redis: await this.redis.ping(), rabbitmq: this.rabbit.isReady, time: new Date().toISOString() };
    if (!dbOk) throw new HttpException(body, 503);
    return body;
  }
}
