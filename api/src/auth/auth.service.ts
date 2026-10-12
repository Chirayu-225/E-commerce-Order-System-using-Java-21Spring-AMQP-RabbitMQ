import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { AuthUser, TokenService } from '../common/auth';
import { ApiError, conflict, parse, unauthorized } from '../common/errors';

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  name: z.string().trim().min(2).max(80),
});
const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(100) });

// Compared against when the email is unknown, so "no such user" and "wrong password" take the same time.
const DUMMY_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8.KfZ8rZ3nQ0m2c7zQ0yq3v8Yb6o1e';

export interface SessionView { token: string; user: AuthUser }

@Injectable()
export class AuthService {
  constructor(private readonly db: DbService, private readonly tokens: TokenService) {}

  async register(body: unknown): Promise<SessionView> {
    const { email, password, name } = parse(registerSchema, body);
    const hash = await bcrypt.hash(password, 10);
    try {
      const r = await this.db.query<{ id: string; role: 'CUSTOMER' | 'ADMIN' }>(
        `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, role`,
        [email, hash, name],
      );
      return this.session({ id: r.rows[0].id, email, name, role: r.rows[0].role });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
      throw e;
    }
  }

  async login(body: unknown): Promise<SessionView> {
    const { email, password } = parse(loginSchema, body);
    const r = await this.db.query<{ id: string; email: string; name: string; role: 'CUSTOMER' | 'ADMIN'; password_hash: string }>(
      `SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = $1`, [email]);
    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    return this.session({ id: u.id, email: u.email, name: u.name, role: u.role });
  }

  async me(user: AuthUser): Promise<AuthUser> {
    const r = await this.db.query<{ id: string; email: string; name: string; role: 'CUSTOMER' | 'ADMIN' }>(
      `SELECT id, email, name, role FROM users WHERE id = $1`, [user.id]);
    if (!r.rows[0]) throw unauthorized('Account no longer exists');
    return r.rows[0];
  }

  private session(user: AuthUser): SessionView {
    return { token: this.tokens.sign(user), user };
  }
}
