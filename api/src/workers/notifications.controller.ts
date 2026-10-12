import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { AuthGuard, AuthUser, CurrentUser } from '../common/auth';

@Controller('api/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const r = await this.db.query(
      `SELECT id, order_id AS "orderId", title, body, created_at AS "createdAt", read_at IS NOT NULL AS read
         FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [user.id]);
    return { unread: r.rows.filter((x) => !x.read).length, items: r.rows };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.db.query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`, [user.id]);
    return { ok: true };
  }
}
