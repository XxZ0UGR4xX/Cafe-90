import { createApp } from './bootstrap';
import { loadEnv } from './config/env';

async function main() {
  const env = loadEnv();
  const app = await createApp();
  await app.listen(env.PORT, '0.0.0.0');
}
main().catch((e) => { console.error(e); process.exit(1); });
