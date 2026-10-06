import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards, CanActivate, ExecutionContext, Injectable, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ChangePasswordDto, LoginDto, MfaCodeDto, MfaDisableDto, MfaEnrollFinishDto, MfaEnrollStartDto, MfaVerifyDto, PinLoginDto } from '@retroburger/shared';
import { ENV, type Env } from '../../config/env';
import { AppError, unauthenticated } from '../../common/errors';
import { RateLimiter } from '../../common/rate-limiter';
import { Authenticated, Public } from './access.decorators';
import { AuthService, type Session } from './auth.service';
import { MfaService } from './mfa.service';

class LoginBody extends createZodDto(LoginDto) {}
class PinLoginBody extends createZodDto(PinLoginDto) {}
class ChangePasswordBody extends createZodDto(ChangePasswordDto) {}

class MfaVerifyBody extends createZodDto(MfaVerifyDto) {}
class MfaEnrollStartBody extends createZodDto(MfaEnrollStartDto) {}
class MfaEnrollFinishBody extends createZodDto(MfaEnrollFinishDto) {}
class MfaCodeBody extends createZodDto(MfaCodeDto) {}
class MfaDisableBody extends createZodDto(MfaDisableDto) {}

const COOKIE = 'rb_refresh';

/** Limita intentos de login por IP+identificador (además del bloqueo por cuenta en BD). */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly limiter: RateLimiter;
  constructor(@Inject(ENV) env: Env) { this.limiter = new RateLimiter(env.LOGIN_RATE_LIMIT_MAX, 60_000); }
  canActivate(c: ExecutionContext): boolean {
    const req = c.switchToHttp().getRequest<FastifyRequest>();
    const b = (req.body ?? {}) as Record<string, string>;
    if (this.limiter.hit(`${req.ip}|${b.tenant}|${b.email ?? b.userCode ?? b.mfaToken?.slice(-24)}`)) throw new AppError('RATE_LIMITED', 429, undefined, true);
    return true;
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly mfa: MfaService, @Inject(ENV) private readonly env: Env) {}

  private setCookie(reply: FastifyReply, s: Session) {
    reply.setCookie(COOKIE, s.refreshToken, {
      httpOnly: true, secure: this.env.COOKIE_SECURE === 'true', sameSite: 'strict', path: '/auth', expires: s.refreshExpiresAt,
    });
    return { accessToken: s.accessToken, expiresIn: s.expiresIn };
  }

  /** CSRF: los endpoints que usan la cookie exigen un header personalizado (no enviable cross-site sin preflight). */
  private csrf(req: FastifyRequest) {
    if (req.headers['x-requested-with'] !== 'retroburger') throw new AppError('FORBIDDEN', 403, { reason: 'csrf' });
  }

  @Public() @UseGuards(LoginRateLimitGuard) @Post('login') @HttpCode(200)
  async login(@Body() body: LoginBody, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.auth.login(body);
    if (r.kind === 'mfa') return { mfaRequired: true, mfaToken: r.mfaToken };
    if (r.kind === 'enroll') return { mfaSetupRequired: true, mfaToken: r.mfaToken };
    return this.setCookie(reply, r.session);
  }

  // ── 2FA (paso intermedio del login) ─────────────────────────────────────────
  @Public() @UseGuards(LoginRateLimitGuard) @Post('2fa/verify') @HttpCode(200)
  async mfaVerify(@Body() b: MfaVerifyBody, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.setCookie(reply, await this.mfa.verifyChallenge(b.mfaToken, b.code));
  }

  @Public() @UseGuards(LoginRateLimitGuard) @Post('2fa/enroll/start') @HttpCode(200)
  mfaEnrollStart(@Body() b: MfaEnrollStartBody) { return this.mfa.enrollStartWithToken(b.mfaToken); }

  @Public() @UseGuards(LoginRateLimitGuard) @Post('2fa/enroll/finish') @HttpCode(200)
  async mfaEnrollFinish(@Body() b: MfaEnrollFinishBody, @Res({ passthrough: true }) reply: FastifyReply) {
    const r = await this.mfa.enrollFinishWithToken(b.mfaToken, b.code);
    return { ...this.setCookie(reply, r.session), recoveryCodes: r.recoveryCodes };
  }

  // ── 2FA (gestión desde una sesión iniciada) ─────────────────────────────────
  @Authenticated() @Post('2fa/setup') @HttpCode(200)
  mfaSetup() { return this.mfa.setup(); }

  @Authenticated() @Post('2fa/enable') @HttpCode(200)
  mfaEnable(@Body() b: MfaCodeBody) { return this.mfa.enable(b.code); }

  @Authenticated() @Post('2fa/disable') @HttpCode(204)
  async mfaDisable(@Body() b: MfaDisableBody) { await this.mfa.disable(b.password, b.code); }

  @Public() @UseGuards(LoginRateLimitGuard) @Post('pin-login') @HttpCode(200)
  async pin(@Body() body: PinLoginBody, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.setCookie(reply, await this.auth.pinLogin(body));
  }

  @Public() @Post('refresh') @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.csrf(req);
    const token = req.cookies?.[COOKIE];
    if (!token) throw unauthenticated();
    try { return this.setCookie(reply, await this.auth.refresh(token)); }
    catch (e) { reply.clearCookie(COOKIE, { path: '/auth' }); throw e; }
  }

  @Authenticated() @Post('logout') @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    this.csrf(req);
    await this.auth.logout(req.cookies?.[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/auth' });
  }

  @Authenticated() @Post('change-password') @HttpCode(204)
  async changePassword(@Body() b: ChangePasswordBody) { await this.auth.changePassword(b.currentPassword, b.newPassword); }

  @Authenticated() @Get('me')
  me() { return this.auth.me(); }
}
