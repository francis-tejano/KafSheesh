import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { isDestructiveDisabled } from './common/flags';
import { HttpErrorFilter } from './common/http-error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  const extraOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: [
      'http://localhost:4200',
      'http://127.0.0.1:4200',
      'http://localhost:4444',
      'http://127.0.0.1:4444',
      ...extraOrigins,
    ],
    credentials: true,
  });
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  console.log(`Kafsheesh API listening on http://localhost:${port}/api`);
  if (isDestructiveDisabled()) {
    console.log(
      'KAFSHEESH_DISABLE_DESTRUCTIVE is on: delete, produce, reset, and Kafka writes are blocked.',
    );
  }
  console.log(
    'Kafsheesh Copyright (C) 2026 Francis Tejano. GNU GPL v3 or later. This program comes with ABSOLUTELY NO WARRANTY.',
  );
}
void bootstrap();
