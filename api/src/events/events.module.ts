import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { RealtimeHub } from './realtime.hub';
import { StreamController } from './stream.controller';

@Module({ imports: [SalesModule], controllers: [StreamController], providers: [RealtimeHub], exports: [RealtimeHub] })
export class EventsModule {}
