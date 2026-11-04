import { Body, Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AllowPasswordChange, AuthUser, CurrentUser, Public, RateLimit } from '../common/decorators';
import { parse } from '../common/zod';
import { changePasswordSchema, loginSchema, MeDto, registerSchema, updateMeSchema } from './auth.dto';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const emailOf = (body: unknown): string => {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase().slice(0, 254) : '';
};

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @RateLimit({ name: 'register-ip', limit: 3, ttlMs: MINUTE, key: (req) => `ip:${req.ip}` })
  @Post('auth/register')
  register(@Body() body: unknown): Promise<MeDto> {
    return this.auth.register(parse(registerSchema, body));
  }

  @Public()
  @RateLimit(
    { name: 'login-ip-email', limit: 5, ttlMs: MINUTE, key: (req) => `${req.ip}|${emailOf(req.body)}` },
    { name: 'login-email', limit: 10, ttlMs: HOUR, key: (req) => `email:${emailOf(req.body)}` },
  )
  @HttpCode(200)
  @Post('auth/login')
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<MeDto> {
    const input = parse(loginSchema, body);
    const { me, user } = await this.auth.login(input.email, input.password);
    this.sessions.setCookie(res, this.sessions.sign(user));
    return me;
  }

  @AllowPasswordChange()
  @HttpCode(204)
  @Post('auth/logout')
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.revokeSessions(user.id);
    this.sessions.clearCookie(res);
  }

  @AllowPasswordChange()
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.getMe(user.id);
  }

  @AllowPasswordChange()
  @Patch('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<MeDto> {
    return this.auth.updateName(user.id, parse(updateMeSchema, body).fullName);
  }

  @AllowPasswordChange()
  @RateLimit({ name: 'password-user', limit: 5, ttlMs: MINUTE, key: (req) => (req.user ? `user:${req.user.id}` : null) })
  @HttpCode(204)
  @Post('me/password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const input = parse(changePasswordSchema, body);
    const updated = await this.auth.changePassword(user.id, input.currentPassword, input.newPassword);
    this.sessions.setCookie(res, this.sessions.sign(updated));
  }
}
