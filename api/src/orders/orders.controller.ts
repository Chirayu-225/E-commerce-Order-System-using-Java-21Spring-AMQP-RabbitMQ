import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { OrdersService } from './orders.service';
import { AuthGuard, AuthUser, CurrentUser, RateLimit, UserRateLimitGuard } from '../common/auth';
import { toInt, clamp } from '../common/util';

@Controller('api/orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** 201 for a new order; 200 + `Idempotent-Replayed: true` when the same Idempotency-Key was already used. */
  @Post()
  @UseGuards(UserRateLimitGuard)
  @RateLimit('checkout')
  async create(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { order, replayed } = await this.orders.create(user, key, body);
    reply.status(replayed ? 200 : 201);
    if (replayed) reply.header('Idempotent-Replayed', 'true');
    return order;
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.orders.listForUser(user.id, clamp(toInt(page, 1), 1, 1000), clamp(toInt(pageSize, 20), 1, 50));
  }

  @Get(':id')
  one(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.getForUser(user.id, id, user.role === 'ADMIN');
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.orders.cancel(user, id);
  }
}
