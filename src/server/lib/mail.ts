import nodemailer from "nodemailer";
import { logger } from "./logger.ts";

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}

/** Ports where the server expects TLS from the first byte (implicit TLS). */
const IMPLICIT_TLS_PORTS = new Set([465, 2465]);

/**
 * Sends through an SMTP server, always over TLS: implicit TLS on 465 and
 * 2465, STARTTLS on any other port. A server that doesn't offer STARTTLS, or
 * whose certificate doesn't verify, gets nothing sent to it, not even the
 * login.
 */
export function smtpMailer(settings: SmtpSettings): Mailer {
  const implicitTls = IMPLICIT_TLS_PORTS.has(settings.port);
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: implicitTls,
    requireTLS: !implicitTls,
    tls: { rejectUnauthorized: true },
    auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: settings.from, ...mail });
      logger.info("mail sent", { subject: mail.subject });
    },
  };
}

/** Writes mail to the log instead, for development without an SMTP server. */
export const logMailer: Mailer = {
  async send(mail) {
    logger.info("mail not sent (SMTP is not configured)", { ...mail });
  },
};
