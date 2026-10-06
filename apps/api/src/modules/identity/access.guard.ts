import { CanActivate, ExecutionContext, Injectable, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { Permission } from '@retroburger/shared';
import { ENV, type Env } from '../../config/env';
import { ctx } from '../../common/request-context';
import { forbidden, unauthenticated } from '../../common/errors';
import { AUTHENTICATED_KEY, PUBLIC_KEY, REQUIRE_KEY } from './access.decorators';
import { PrincipalRepository } from './principal.repository';
import { verifyAccess } from './tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard global: autenticación (JWT) + autorización (RBAC con alcance de sucursal).
 * FALLA CERRADO: un endpoint sin @Public/@Authenticated/@Require es rechazado.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly principals: PrincipalRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthenticated();

    let claims;
    try { claims = await verifyAccess(header.slice(7), this.env.JWT_ACCESS_SECRET); }
    catch { throw unauthenticated(); }

    const principal = await this.principals.load(claims.sub, claims.tid);
    if (!principal) throw unauthenticated();
    const store = ctx();
    store.tenantId = claims.tid;
    store.principal = principal;

    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRE_KEY, targets);
    if (!required?.length) throw forbidden({ reason: 'endpoint sin permiso declarado' });

    const branchId = this.branchOf(req);
    for (const p of required) if (!principal.can(p, branchId)) throw forbidden({ permission: p });
    return true;
  }

  private branchOf(req: FastifyRequest): string | undefined {
    const candidates = [
      (req.params as any)?.branchId, (req.query as any)?.branchId,
      req.headers['x-branch-id'], (req.body as any)?.branchId,
    ];
    const v = candidates.find((x) => typeof x === 'string' && x);
    if (v === undefined) return undefined;
    if (!UUID.test(v)) throw forbidden({ reason: 'branchId inválido' });
    return v;
  }
}
