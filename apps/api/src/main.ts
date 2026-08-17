import "reflect-metadata";
import "dotenv/config";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { env } from "./common/config/env";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  await app.listen(env.API_PORT, "0.0.0.0");
  console.log(`API listening on http://0.0.0.0:${env.API_PORT}`);
}

bootstrap();
