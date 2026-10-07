import nodemailer from 'nodemailer';

export interface MailMessage {
  from: string; to: string[]; subject: string; text: string; html?: string;
  attachments?: { filename: string; contentType: string; content: string }[];
}
export interface MailTransport { readonly kind: 'smtp' | 'log'; send(m: MailMessage): Promise<void> }

/** Desarrollo/pruebas: no sale nada de la máquina; se conserva en memoria (últimos 100) y se registra. */
export class LogTransport implements MailTransport {
  readonly kind = 'log' as const;
  readonly sent: MailMessage[] = [];
  /** Para pruebas: hace fallar los próximos N envíos. */
  failNext = 0;
  async send(m: MailMessage) {
    if (this.failNext > 0) { this.failNext--; throw new Error('SMTP simulado: conexión rechazada'); }
    this.sent.push(m); if (this.sent.length > 100) this.sent.shift();
  }
}

export class SmtpTransport implements MailTransport {
  readonly kind = 'smtp' as const;
  private readonly t;
  constructor(url: string) { this.t = nodemailer.createTransport({ url, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 }); }
  async send(m: MailMessage) {
    await this.t.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html,
      attachments: m.attachments?.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })) });
  }
}
