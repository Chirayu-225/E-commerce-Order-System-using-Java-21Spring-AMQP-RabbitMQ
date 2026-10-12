import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller('api')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  list(@Query() query: Record<string, unknown>) { return this.catalog.list(query); }

  @Get('products/:id')
  one(@Param('id', new ParseUUIDPipe()) id: string) { return this.catalog.get(id); }

  @Get('categories')
  categories() { return this.catalog.categories(); }
}
