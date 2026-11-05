import { Module } from '@nestjs/common';
import { MailOutboxWorker } from './mail-outbox.worker';
import { MailTransport, SmtpMailTransport } from './mail-transport';

@Module({
  providers: [{ provide: MailTransport, useClass: SmtpMailTransport }, MailOutboxWorker],
  exports: [MailOutboxWorker, MailTransport],
})
export class MailModule {}
