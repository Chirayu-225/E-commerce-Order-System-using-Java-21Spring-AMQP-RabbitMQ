import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { PaymentsService } from './payments.service';
import { AuthGuard, AuthUser, CurrentUser, SkipRateLimit } from '../common/auth';
import { ApiError } from '../common/errors';

@Controller('api')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('orders/:id/payments')
  @UseGuards(AuthGuard)
  start(@CurrentUser() user: AuthUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.payments.start(user, id);
  }

  /** Test-mode gateway simulator (disabled when GATEWAY_SIMULATOR=false). */
  @Post('gateway/pay')
  @HttpCode(202)
  @UseGuards(AuthGuard)
  pay(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.payments.simulatePay(user, body);
  }

  /** Called by the gateway.  Authenticated by signature, not by user token; verified against the RAW body bytes. */
  @Post('payments/webhook')
  @HttpCode(200)
  @SkipRateLimit()
  webhook(@Req() req: FastifyRequest & { rawBody?: Buffer | string }, @Headers('x-signature') sig: string | undefined) {
    const raw = req.rawBody;
    if (raw === undefined) throw new ApiError(400, 'NO_BODY', 'Empty webhook body');
    return this.payments.processWebhook(typeof raw === 'string' ? raw : raw.toString('utf8'), sig);
  }
}
