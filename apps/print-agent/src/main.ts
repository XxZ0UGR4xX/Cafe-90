import { PrintAgent } from './agent';
import { HttpApi } from './client';

const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`Falta la variable ${k}. Ver apps/print-agent/README.md`); process.exit(1); } return v; };
const cfg = {
  baseUrl: need('AGENT_API_URL').replace(/\/$/, ''), tenant: need('AGENT_TENANT'), email: need('AGENT_EMAIL'), password: need('AGENT_PASSWORD'),
  branchId: need('AGENT_BRANCH_ID'), pollMs: Number(process.env.AGENT_POLL_MS ?? 2000),
};
const log = (level: string, msg: string) => console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`${new Date().toISOString()} [${level}] ${msg}`);
const agent = new PrintAgent(new HttpApi(cfg), { branchId: cfg.branchId, pollMs: cfg.pollMs, log: log as any });
agent.start();
log('info', `Agente de impresión iniciado · sucursal ${cfg.branchId} · cada ${cfg.pollMs} ms`);
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { agent.stop(); log('info', 'Agente detenido'); process.exit(0); });
