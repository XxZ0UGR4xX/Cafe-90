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

/** Recursos de TODA la cadena (menú, recetas, promociones, reglas de lealtad): su escritura exige alcance corporativo, no basta ser gerente de una sucursal. */
const TENANT_WIDE = new Set<string>(['catalog.product.write', 'catalog.recipe.write', 'promotions.promotion.write', 'loyalty.rule.write']);
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

    const principal = await this.principals.load(claims.sub, claims.tid, claims.sid);
    if (!principal) throw unauthenticated();
    const store = ctx();
    store.tenantId = claims.tid;
    store.principal = principal;

    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRE_KEY, targets);
    if (!required?.length) throw forbidden({ reason: 'endpoint sin permiso declarado' });

    // TODOS los branchId presentes (ruta, query, cabecera, cuerpo) deben estar permitidos: no se puede validar uno y operar sobre otro.
    const branches = this.branchesOf(req);
    for (const p of required) {
      if (!branches.length) {
        if (!principal.can(p, undefined)) throw forbidden({ permission: p });
        if (TENANT_WIDE.has(p) && principal.branchScope(p) !== null) throw forbidden({ permission: p, reason: 'recurso de toda la cadena: requiere alcance corporativo' });
        continue;
      }
      for (const b of branches) if (!principal.can(p, b)) throw forbidden({ permission: p });
    }
    return true;
  }

  private branchesOf(req: FastifyRequest): string[] {
    const candidates = [
      (req.params as any)?.branchId, (req.query as any)?.branchId,
      req.headers['x-branch-id'], (req.body as any)?.branchId,
    ].filter((x) => typeof x === 'string' && x) as string[];
    for (const v of candidates) if (!UUID.test(v)) throw forbidden({ reason: 'branchId inválido' });
    return [...new Set(candidates.map((c) => c.toLowerCase()))];
  }
}
