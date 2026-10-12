import { Controller, Get, Inject, OnModuleDestroy, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppConfig, CONFIG } from '../config/config';
import { AuthGuard, AuthUser, CurrentUser, SkipRateLimit } from '../common/auth';
import { RealtimeHub } from './realtime.hub';
import { SalesService } from '../sales/sales.service';

@Controller('api/stream')
@SkipRateLimit()
export class StreamController implements OnModuleDestroy {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly hub: RealtimeHub,
    private readonly sales: SalesService,
  ) {}

  private open(req: FastifyRequest, reply: FastifyReply, channel: string, hello: () => Promise<unknown> | unknown): void {
    // We write to the raw socket ourselves, so Fastify's CORS hook does not run: add the headers here.
    const origin = req.headers.origin;
    const allowed = origin && (this.cfg.corsOrigins.includes('*') || this.cfg.corsOrigins.includes(origin));
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin as string, Vary: 'Origin' } : {}),
    });
    res.write('retry: 3000\n\n');
    const remove = this.hub.add(channel, res);
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 20_000);
    req.raw.on('close', () => { clearInterval(beat); remove(); });
    Promise.resolve(hello()).then((p) => { if (p) res.write(`event: hello\ndata: ${JSON.stringify(p)}\n\n`); }).catch(() => undefined);
  }

  @Get('sales/:id')
  sale(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    this.open(req, reply, `sale:${id}`, async () => ({ type: 'stock', saleId: id, remaining: await this.sales.getRemaining(id) }));
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    this.open(req, reply, `user:${user.id}`, () => ({ type: 'connected' }));
  }

  onModuleDestroy(): void { this.hub.closeAll(); }
}
