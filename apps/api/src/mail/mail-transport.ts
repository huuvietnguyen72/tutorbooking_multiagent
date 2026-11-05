import { Inject, Injectable } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { APP_ENV } from '../common/config';
import type { Env } from '../config/env';

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Seam for tests: the worker only needs "send or throw". */
export abstract class MailTransport {
  abstract send(mail: OutgoingMail): Promise<void>;
}

@Injectable()
export class SmtpMailTransport extends MailTransport {
  private readonly transporter: Transporter;

  constructor(@Inject(APP_ENV) private readonly env: Env) {
    super();
    this.transporter = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: false,
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  async send(mail: OutgoingMail): Promise<void> {
    await this.transporter.sendMail({ from: this.env.MAIL_FROM, ...mail });
  }
}
