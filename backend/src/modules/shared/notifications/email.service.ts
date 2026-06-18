import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  link?: string;
  actionLabel?: string;
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly directFallback: Transporter | null;
  private readonly from: string;
  private readonly ehloName: string;
  private readonly mode: 'off' | 'dev' | 'live' | 'prod';
  private readonly devRecipient?: string;
  private readonly platformUrl: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('MAIL_HOST')?.trim();
    const port = Number(this.configService.get<string>('MAIL_PORT') ?? '0');
    const user = this.configService.get<string>('MAIL_USER')?.trim();
    const pass = this.configService.get<string>('MAIL_PASS')?.trim();
    const useAuth = this.parseBoolean(
      this.configService.get<string>('MAIL_AUTH') ?? 'false',
    );
    this.from =
      this.configService.get<string>('MAIL_FROM')?.trim() ??
      'noreply@localhost';
    this.ehloName =
      this.configService.get<string>('MAIL_EHLO_NAME')?.trim() ||
      this.mailDomain(this.from) ||
      'localhost';
    this.mode = this.normalizeMode(
      this.configService.get<string>('EMAIL_MODE') ?? 'off',
    );
    this.devRecipient = this.normalizeEmail(
      this.configService.get<string>('DEV_EMAIL_RECIPIENT') ?? '',
    );
    this.platformUrl = this.normalizeBaseUrl(
      this.configService.get<string>('FRONTEND_URL') ??
        this.configService.get<string>('APP_BASE_URL') ??
        this.configService.get<string>('PUBLIC_APP_URL') ??
        'http://localhost:5173',
    );

    if (!host || !port) {
      this.transporter = this.createDirectTransporter();
      this.directFallback = null;
      this.logger.warn(
        "SMTP non configure: tentative d'envoi direct sans compte SMTP.",
      );
      return;
    }

    if (useAuth && (!user || !pass)) {
      this.logger.warn(
        'MAIL_AUTH=true mais identifiants SMTP manquants: auth desactivee.',
      );
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      name: this.ehloName,
      ...(useAuth && user && pass
        ? {
            auth: {
              user,
              pass,
            },
          }
        : {}),
    });
    this.directFallback = this.createDirectTransporter();
  }

  async sendMany(messages: EmailMessage[]) {
    if (messages.length === 0) return;
    for (const message of messages) {
      await this.send(message);
    }
  }

  async send(message: EmailMessage) {
    if (!this.transporter || this.mode === 'off') return;

    const to = this.resolveRecipient(message.to);
    if (!to) return;

    const finalSubject =
      this.mode === 'dev' ? `[DEV] ${message.subject}` : message.subject;

    const actionUrl = message.link
      ? this.resolvePlatformLink(message.link)
      : undefined;
    const mail = {
      from: this.from,
      to,
      subject: finalSubject,
      text: this.withTextFooter(message.text, actionUrl),
      html:
        message.html ??
        this.buildHtmlEmail({
          subject: finalSubject,
          text: message.text,
          actionUrl,
          actionLabel: message.actionLabel,
        }),
    };

    try {
      await this.transporter.sendMail(mail);
    } catch (error) {
      if (this.directFallback && this.shouldTryDirectFallback(error)) {
        this.logger.warn(
          `Relais SMTP indisponible (${this.errorSummary(error)}): tentative d'envoi direct vers ${to}.`,
        );

        try {
          await this.directFallback.sendMail(mail);
          return;
        } catch (fallbackError) {
          this.logger.error(
            `Echec d'envoi direct vers ${to} (sujet: ${finalSubject})`,
            fallbackError instanceof Error
              ? fallbackError.stack
              : String(fallbackError),
          );
          return;
        }
      }

      this.logger.error(
        `Echec d'envoi email vers ${to} (sujet: ${finalSubject})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private resolveRecipient(email: string) {
    if (this.mode === 'dev' && this.devRecipient) return this.devRecipient;

    const normalized = this.normalizeEmail(email);
    if (!normalized) return null;

    return normalized;
  }

  private normalizeMode(mode: string) {
    const normalized = mode.trim().toLowerCase();
    if (
      normalized === 'dev' ||
      normalized === 'live' ||
      normalized === 'prod'
    ) {
      return normalized;
    }
    return 'off';
  }

  private normalizeEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return undefined;
    return normalized;
  }

  private createDirectTransporter() {
    return nodemailer.createTransport({ direct: true, name: this.ehloName });
  }

  private mailDomain(value: string) {
    const match = value.match(/@([^>\s]+)>?$/);
    return match?.[1]?.toLowerCase();
  }

  private shouldTryDirectFallback(error: unknown) {
    const details = this.errorSummary(error).toLowerCase();
    return (
      details.includes('421') ||
      details.includes('ehlo') ||
      details.includes('etimedout') ||
      details.includes('econnreset') ||
      details.includes('econnrefused') ||
      details.includes('connection')
    );
  }

  private errorSummary(error: unknown) {
    if (!(error instanceof Error)) return String(error);
    const response = (error as { response?: unknown }).response;
    const responseCode = (error as { responseCode?: unknown }).responseCode;
    const code = (error as { code?: unknown }).code;
    const command = (error as { command?: unknown }).command;
    const parts = [code, responseCode, command, response, error.message]
      .filter((part) => part !== undefined && part !== null && part !== '')
      .map(String);
    return parts.join(' | ');
  }

  private parseBoolean(value: string) {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }

  private normalizeBaseUrl(value: string) {
    const trimmed = value.trim().replace(/\/+$/, '');
    return trimmed || 'http://localhost:5173';
  }

  private resolvePlatformLink(link: string) {
    const trimmed = link.trim();
    if (!trimmed) return undefined;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `${this.platformUrl}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  }

  private withTextFooter(text: string, actionUrl?: string) {
    if (!actionUrl) return text;
    return `${text}\n\nOuvrir dans la plateforme: ${actionUrl}`;
  }

  private buildHtmlEmail(params: {
    subject: string;
    text: string;
    actionUrl?: string;
    actionLabel?: string;
  }) {
    const paragraphs = params.text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${this.escapeHtml(line)}</p>`)
      .join('');
    const action = params.actionUrl
      ? `<p style="margin:28px 0 0"><a href="${this.escapeAttribute(
          params.actionUrl,
        )}" style="display:inline-block;border-radius:6px;background:#0f766e;color:#ffffff;font-weight:700;text-decoration:none;padding:12px 18px">${this.escapeHtml(
          params.actionLabel ?? 'Ouvrir la plateforme',
        )}</a></p><p style="font-size:12px;color:#64748b;word-break:break-all">Lien direct : ${this.escapeHtml(
          params.actionUrl,
        )}</p>`
      : '';

    return `<!doctype html>
<html lang="fr">
  <body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
            <tr>
              <td style="background:#0f766e;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:700">UP congés</td>
            </tr>
            <tr>
              <td style="padding:28px 24px">
                <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a">${this.escapeHtml(
                  params.subject,
                )}</h1>
                <div style="font-size:15px;line-height:1.6;color:#334155">${paragraphs}</div>
                ${action}
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e2e8f0;padding:14px 24px;font-size:12px;color:#64748b">Message automatique de la plateforme de gestion des congés.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeAttribute(value: string) {
    return this.escapeHtml(value);
  }
}
