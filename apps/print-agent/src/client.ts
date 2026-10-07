export interface PrinterInfo { id: string; branchId: string; name: string; role: string; connection: Record<string, unknown>; columns: number; isActive: boolean }
export interface PrintJob { id: string; kind: string; content: string; attempts: number }

export interface AgentApi {
  printers(branchId: string): Promise<PrinterInfo[]>;
  pending(printerId: string): Promise<PrintJob[]>;
  ack(jobId: string, ok: boolean): Promise<void>;
}

export interface ApiConfig { baseUrl: string; tenant: string; email: string; password: string }

/** Cliente HTTP con inicio de sesión automático (la cuenta de servicio rol IMPRESION) y reintento tras 401. */
export class HttpApi implements AgentApi {
  private token: string | null = null;
  constructor(private readonly cfg: ApiConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  private async login() {
    const r = await this.fetchImpl(`${this.cfg.baseUrl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: this.cfg.tenant, email: this.cfg.email, password: this.cfg.password }) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.accessToken) throw new Error(`login rechazado (${r.status}${j.mfaRequired ? ': la cuenta tiene 2FA, usa una cuenta de servicio sin 2FA' : ''})`);
    this.token = j.accessToken;
  }

  private async req<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
    if (!this.token) await this.login();
    const r = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && retry) { this.token = null; return this.req(method, path, body, false); }
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
    return (r.status === 204 ? undefined : await r.json()) as T;
  }

  printers(branchId: string) { return this.req<PrinterInfo[]>('GET', `/printers?branchId=${encodeURIComponent(branchId)}`); }
  pending(printerId: string) { return this.req<PrintJob[]>('GET', `/print/jobs/pending?printerId=${encodeURIComponent(printerId)}`); }
  async ack(jobId: string, ok: boolean) { await this.req('POST', `/print/jobs/${jobId}/ack`, { ok }); }
}
