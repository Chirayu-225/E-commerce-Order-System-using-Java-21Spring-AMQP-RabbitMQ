import { CanActivate, ExecutionContext, Injectable, createParamDecorator, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { Inject } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { ApiError, forbidden, unauthorized } from './errors';
import { RedisService } from '../redis/redis.service';

export interface AuthUser { id: string; email: string; name: string; role: 'CUSTOMER' | 'ADMIN' }

declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser }
}

@Injectable()
export class TokenService {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  sign(u: AuthUser): string {
    return jwt.sign({ email: u.email, name: u.name, role: u.role }, this.cfg.jwtSecret, {
      subject: u.id, expiresIn: this.cfg.jwtTtlSeconds, algorithm: 'HS256',
    });
  }

  verify(token: string): AuthUser | null {
    try {
      const p = jwt.verify(token, this.cfg.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      if (!p.sub) return null;
      return { id: p.sub, email: String(p.email), name: String(p.name), role: p.role === 'ADMIN' ? 'ADMIN' : 'CUSTOMER' };
    } catch { return null; }
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    let token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    // EventSource cannot send headers, so the live-stream endpoints (and only those) accept ?access_token=
    if (!token && req.url.startsWith('/api/stream/')) {
      const q = (req.query as Record<string, unknown>)?.access_token;
      if (typeof q === 'string') token = q;
    }
    if (!token) throw unauthorized();
    const user = this.tokens.verify(token);
    if (!user) throw unauthorized('Invalid or expired token');
    req.user = user;
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest<FastifyRequest>().user;
    if (user?.role !== 'ADMIN') throw forbidden('Admin access required');
    return true;
  }
}

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<FastifyRequest>().user as AuthUser;
});

// ---- rate limiting (Redis token bucket) ----------------------------------------------------------
export const SKIP_RATE_LIMIT = 'skipRateLimit';
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT, true);
export const RATE_LIMIT = 'rateLimit';
export const RateLimit = (bucket: 'checkout') => SetMetadata(RATE_LIMIT, bucket);

/** Global per-IP limit: the first line of defence against scrapers and request floods.  Fails OPEN if Redis is down. */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.cfg.rateLimit.enabled) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    try {
      const r = await this.redis.takeToken(`ip:${req.ip}`, this.cfg.rateLimit.ipBurst, this.cfg.rateLimit.ipPerSec);
      if (!r.allowed) {
        this.redis.incr('rate_limited_ip');
        throw new ApiError(429, 'RATE_LIMITED', 'Too many requests, slow down', { retryAfterSec: Math.ceil(r.retryAfterMs / 1000) });
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      this.redis.incr('rate_limit_bypassed');
    }
    return true;
  }
}

/** Per-user limit for expensive endpoints (checkout).  Runs AFTER AuthGuard so the subject is the user, not the IP. */
@Injectable()
export class UserRateLimitGuard implements CanActivate {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.cfg.rateLimit.enabled) return true;
    const bucket = this.reflector.get<string>(RATE_LIMIT, ctx.getHandler());
    if (!bucket) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const subject = req.user?.id ?? req.ip;
    try {
      const r = await this.redis.takeToken(`${bucket}:${subject}`, this.cfg.rateLimit.checkoutBurst, this.cfg.rateLimit.checkoutPerSec);
      if (!r.allowed) {
        this.redis.incr('rate_limited_user');
        throw new ApiError(429, 'RATE_LIMITED', 'You are trying too fast. Please wait a moment.', { retryAfterSec: Math.ceil(r.retryAfterMs / 1000) });
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      this.redis.incr('rate_limit_bypassed');
    }
    return true;
  }
}
