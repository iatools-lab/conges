import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { configureApp } from './app.setup';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  configureApp(app, configService);

  const shouldExposeSwagger =
    process.env.NODE_ENV !== 'production' ||
    configService.get<string>('ENABLE_SWAGGER')?.trim().toLowerCase() ===
      'true';

  if (shouldExposeSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Conges upOwa API')
      .setDescription('Documentation de l\'API Conges upOwa')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, swaggerDocument);
  }

  await app.listen(configService.get<number>('PORT') ?? 3000);
}
bootstrap();
