import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { OrdersService } from '../orders/orders.service';
import { AdminGuard, AuthGuard } from '../common/auth';
import { clamp, toInt } from '../common/util';

@Controller('api/admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly orders: OrdersService) {}

  @Get('stats') stats() { return this.admin.stats(); }
  @Get('integrity') integrity() { return this.admin.integrity(); }
  @Get('system') system() { return this.admin.system(); }
  @Get('products') products() { return this.admin.products(); }

  @Get('orders')
  listOrders(@Query('status') status?: string, @Query('page') page?: string) {
    return this.orders.listAll({ status, page: clamp(toInt(page, 1), 1, 1000) });
  }

  @Post('products/:id/restock')
  @HttpCode(200)
  restock(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) { return this.admin.restock(id, body); }

  @Post('flash-sales')
  createSale(@Body() body: unknown) { return this.admin.createSale(body); }

  @Post('reconcile-gates')
  @HttpCode(200)
  reconcile() { return this.admin.reconcile(); }
}
