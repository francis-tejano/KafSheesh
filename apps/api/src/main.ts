import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http-error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: [
      'http://localhost:4200',
      'http://127.0.0.1:4200',
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
  console.log(
    'Kafsheesh Copyright (C) 2026 Francis Tejano. GNU GPL v3 or later. This program comes with ABSOLUTELY NO WARRANTY.',
  );
}
bootstrap();
