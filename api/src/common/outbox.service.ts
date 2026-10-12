import { Injectable } from '@nestjs/common';
import { Db } from '../db/db.service';

@Injectable()
export class OutboxService {
  /**
   * Record a domain event IN THE CALLER'S TRANSACTION.  If the business change rolls back, the event
   * disappears with it; if it commits, the relay is guaranteed to find it.  pg_notify wakes the relay
   * immediately on commit (it also polls, so a lost notification only costs a second).
   */
  async add(c: Db, type: string, aggregateType: string, aggregateId: string, data: unknown): Promise<void> {
    await c.query(
      `WITH ins AS (
         INSERT INTO outbox (aggregate_type, aggregate_id, type, payload) VALUES ($1, $2, $3, $4::jsonb) RETURNING 1
       ) SELECT pg_notify('outbox', '') FROM ins`,
      [aggregateType, aggregateId, type, JSON.stringify(data)],
    );
  }
}
