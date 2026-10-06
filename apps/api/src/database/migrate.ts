/**
 * Runner de migraciones SQL forward-only.
 * Aplica db/migrations/*.sql en orden, registra en schema_migrations y otorga permisos al rol de la app.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Client } from 'pg';

const DIR = join(__dirname, '../../../../db/migrations');

export async function migrate(url: string, appRole = 'retroburger_app', log = console.log): Promise<string[]> {
  const client = new Client({ connectionString: url });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map<string, string>(
      (await client.query('SELECT name, checksum FROM schema_migrations')).rows.map((r) => [r.name, r.checksum]),
    );
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (done.has(f)) {
        if (done.get(f) !== checksum) throw new Error(`La migración ya aplicada ${f} fue modificada`);
        continue;
      }
      log(`→ aplicando ${f}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1,$2)', [f, checksum]);
        await client.query('COMMIT');
        applied.push(f);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migración ${f} falló: ${(e as Error).message}`);
      }
    }
    // Permisos mínimos para el rol de la aplicación (sin BYPASSRLS, no es dueño).
    const role = `"${appRole.replace(/"/g, '')}"`;
    await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    await client.query(`REVOKE ALL ON schema_migrations FROM ${role}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);
  } finally {
    await client.end();
  }
  return applied;
}

if (require.main === module) {
  const url = process.env.DATABASE_MIGRATE_URL;
  if (!url) throw new Error('DATABASE_MIGRATE_URL requerido');
  migrate(url, process.env.APP_DB_ROLE ?? 'retroburger_app')
    .then((a) => console.log(a.length ? `Aplicadas: ${a.join(', ')}` : 'Base al día'))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
