import type { Permission } from '@retroburger/shared';

export interface RoleGrant { roleKey: string; branchId: string | null }

/** Identidad autenticada + permisos efectivos con alcance por sucursal. */
export class Principal {
  constructor(
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly fullName: string,
    public readonly grants: RoleGrant[],
    /** permiso -> 'ALL' (todas las sucursales) o conjunto de branchIds */
    private readonly scopes: Map<string, 'ALL' | Set<string>>,
  ) {}

  /** ¿Tiene el permiso (en cualquier alcance, o en la sucursal indicada)? */
  can(permission: Permission | string, branchId?: string | null): boolean {
    const s = this.scopes.get(permission);
    if (!s) return false;
    if (s === 'ALL') return true;
    return branchId ? s.has(branchId) : true;
  }

  /** Sucursales a las que puede acceder con el permiso; null = todas. */
  branchScope(permission: Permission | string): string[] | null {
    const s = this.scopes.get(permission);
    if (!s) return [];
    return s === 'ALL' ? null : [...s];
  }

  get isCorporate(): boolean { return this.grants.some((g) => g.branchId === null); }

  permissionList(): Record<string, 'ALL' | string[]> {
    const out: Record<string, 'ALL' | string[]> = {};
    for (const [k, v] of this.scopes) out[k] = v === 'ALL' ? 'ALL' : [...v];
    return out;
  }

  static build(userId: string, tenantId: string, fullName: string,
    rows: { role_key: string; branch_id: string | null; permission_key: string | null }[]): Principal {
    const scopes = new Map<string, 'ALL' | Set<string>>();
    const grants = new Map<string, RoleGrant>();
    for (const r of rows) {
      grants.set(`${r.role_key}:${r.branch_id}`, { roleKey: r.role_key, branchId: r.branch_id });
      if (!r.permission_key) continue;
      const cur = scopes.get(r.permission_key);
      if (r.branch_id === null) scopes.set(r.permission_key, 'ALL');
      else if (cur === 'ALL') continue;
      else (cur ?? scopes.set(r.permission_key, new Set()).get(r.permission_key)! as Set<string>).add(r.branch_id);
    }
    return new Principal(userId, tenantId, fullName, [...grants.values()], scopes);
  }

  /** Principal sintético (sin login) para flujos públicos/QR: sólo los permisos indicados, todas las sucursales. */
  static system(userId: string, tenantId: string, name: string, permissions: string[]): Principal {
    return new Principal(userId, tenantId, name, [], new Map(permissions.map((p) => [p, 'ALL' as const])));
  }
}
