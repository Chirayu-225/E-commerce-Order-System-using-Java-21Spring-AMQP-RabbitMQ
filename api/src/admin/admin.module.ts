import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { OrdersModule } from '../orders/orders.module';
import { SalesModule } from '../sales/sales.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({ imports: [SalesModule, OrdersModule, EventsModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
