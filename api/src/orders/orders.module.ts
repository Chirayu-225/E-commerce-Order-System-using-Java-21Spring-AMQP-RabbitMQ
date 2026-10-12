import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({ imports: [SalesModule], controllers: [OrdersController], providers: [OrdersService], exports: [OrdersService] })
export class OrdersModule {}
