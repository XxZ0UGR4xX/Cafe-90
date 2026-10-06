import { migrate } from '../src/database/migrate';

export default async function setup() {
  const url = process.env.DATABASE_MIGRATE_URL ?? 'postgres://retroburger_owner:owner_dev@localhost:5432/retroburger_test';
  await migrate(url, 'retroburger_app', () => undefined);
}
