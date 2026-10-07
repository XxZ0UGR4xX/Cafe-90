import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Api, startApi } from './helpers';
import { Fixture, buildFixture } from './fixtures';

let api: Api; let f: Fixture; let ids: string[] = [];
beforeAll(async () => {
  api = await startApi(); f = await buildFixture(api, 'plan');
  // las mesas del fixture nacen todas en (0,0): se acomodan en fila con el propio endpoint (de derecha a izquierda, sin chocar)
  ids = f.tables;
  for (let i = ids.length - 1; i >= 0; i--) expect((await mv(ids[i]!, i * 2, 0, f.admin)).status).toBe(200);
});
afterAll(async () => { await f.close(); await api.app.close(); });
const mv = (id: string, x: number, y: number, token: string, branch = f.branchId) => api.req('PATCH', `/branches/${branch}/tables/${id}/position`, { token, body: { x, y } });
const pos = async (id: string) => (await f.sql('SELECT x, y FROM tables WHERE id=$1', [id]))[0];

describe('plano: reubicar mesas', () => {
  it('mueve a un lugar libre y lo audita', async () => {
    expect((await mv(ids[0]!, 0, 3, f.tokens.gerente)).status).toBe(200);
    expect(await pos(ids[0]!)).toEqual({ x: 0, y: 3 });
    const a = await f.sql(`SELECT old_value, new_value FROM audit_logs WHERE action='table.reposition' AND entity_id=$1 ORDER BY at DESC, id DESC LIMIT 1`, [ids[0]]);
    expect(a[0].old_value).toEqual({ x: 0, y: 0 }); expect(a[0].new_value).toEqual({ x: 0, y: 3 });
  });

  it('rechaza encimar otra mesa (409 con mensaje claro) y no cambia nada', async () => {
    const r = await mv(ids[1]!, 4, 0, f.admin);          // (4,0) está ocupada por la mesa 3
    expect(r.status).toBe(409); expect(r.body.message).toContain('ya está la mesa 3');
    expect((await pos(ids[1]!))).toEqual({ x: 2, y: 0 });
  });

  it('mover sobre su propio lugar es válido; fuera de límites o decimales → 400', async () => {
    expect((await mv(ids[1]!, 2, 0, f.admin)).status).toBe(200);
    expect((await mv(ids[1]!, -1, 0, f.admin)).status).toBe(400);
    expect((await mv(ids[1]!, 0, 999, f.admin)).status).toBe(400);
    expect((await mv(ids[1]!, 1.5, 0, f.admin)).status).toBe(400);
  });

  it('las mesas desactivadas no bloquean el lugar', async () => {
    await f.sql('UPDATE tables SET is_active=false WHERE id=$1', [ids[3]]);
    expect((await mv(ids[2]!, 6, 0, f.admin)).status).toBe(200);      // donde estaba la mesa 4 (inactiva)
  });

  it('permisos y alcance: el mesero no reubica; otra sucursal no se toca', async () => {
    expect((await mv(ids[1]!, 2, 5, f.tokens.mesero)).status).toBe(403);
    const other = (await api.req('POST', '/branches', { token: f.admin, body: { name: 'Otra', code: 'OTRA' } })).body;
    expect((await mv(ids[1]!, 2, 5, f.admin, other.id)).status).toBe(404);    // la mesa no pertenece a esa sucursal
    expect((await mv('00000000-0000-4000-8000-000000000000', 0, 0, f.admin)).status).toBe(404);
  });

  it('el listado devuelve las posiciones nuevas', async () => {
    const list = (await api.req('GET', `/tables?branchId=${f.branchId}`, { token: f.tokens.mesero })).body;
    expect(list.find((t: any) => t.id === ids[0]!)).toMatchObject({ x: 0, y: 3 });
  });
});
