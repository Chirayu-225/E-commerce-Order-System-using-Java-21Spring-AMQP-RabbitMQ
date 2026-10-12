import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({ imports: [SalesModule], controllers: [CatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
