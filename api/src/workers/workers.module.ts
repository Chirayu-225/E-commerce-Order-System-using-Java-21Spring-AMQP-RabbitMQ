import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsController } from './notifications.controller';
import { WorkersService } from './workers.service';

@Module({ imports: [OrdersModule], controllers: [NotificationsController], providers: [WorkersService], exports: [WorkersService] })
export class WorkersModule {}
