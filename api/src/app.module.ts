import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppConfig } from './config/config';
import { CoreModule } from './common/core.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { AuthModule } from './auth/auth.module';
import { SalesModule } from './sales/sales.module';
import { CatalogModule } from './catalog/catalog.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { EventsModule } from './events/events.module';
import { WorkersModule } from './workers/workers.module';
import { AdminModule } from './admin/admin.module';
import { SeedModule } from './seed/seed.module';
import { HealthController } from './health/health.controller';

@Module({})
export class AppModule {
  static forRoot(overrides: Partial<AppConfig> = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(overrides),
        AuthModule, SalesModule, CatalogModule, OrdersModule, PaymentsModule, EventsModule, WorkersModule, AdminModule, SeedModule,
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
    };
  }
}
