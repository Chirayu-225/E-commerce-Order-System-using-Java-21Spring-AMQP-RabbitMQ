import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiError } from './errors';

const TITLES: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  422: 'Unprocessable Entity', 425: 'Too Early', 429: 'Too Many Requests', 500: 'Internal Server Error', 503: 'Service Unavailable',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(err: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (reply.sent || reply.raw.headersSent) return;

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let detail = 'Something went wrong on our side';
    let extra: Record<string, unknown> | undefined;

    if (err instanceof ApiError) {
      status = err.status; code = err.code; detail = err.message; extra = err.extra;
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR';
      const r = err.getResponse();
      detail = typeof r === 'string' ? r : ((r as { message?: string }).message ?? err.message);
    } else {
      this.log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    }

    if (status === 429 && extra && typeof extra.retryAfterSec === 'number') reply.header('Retry-After', String(extra.retryAfterSec));
    void reply.status(status).type('application/problem+json').send({ status, code, title: TITLES[status] ?? 'Error', detail, ...extra });
  }
}
