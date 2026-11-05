import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { validateEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env);
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error('API failed to start:', error);
  process.exit(1);
});
