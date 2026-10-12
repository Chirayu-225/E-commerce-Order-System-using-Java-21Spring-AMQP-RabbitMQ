import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { SalesService } from './sales.service';

@Controller('api/flash-sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** `serverNow` lets the browser correct for a wrong local clock so countdowns hit zero at the true moment. */
  @Get()
  async list() {
    return { serverNow: new Date().toISOString(), sales: await this.sales.list() };
  }

  @Get(':id')
  async one(@Param('id', new ParseUUIDPipe()) id: string) {
    return { serverNow: new Date().toISOString(), sale: await this.sales.get(id) };
  }
}
