import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard, AuthUser, CurrentUser } from '../common/auth';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() body: unknown) { return this.auth.register(body); }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) { return this.auth.login(body); }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) { return this.auth.me(user); }
}
