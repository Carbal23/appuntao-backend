import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SWAGGER_AUTH } from './common/swagger/swagger.constans';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('APPUNTAO API')
    .setDescription(
      'APPUNTAO API para gestión de negocios, deudas, pagos y usuarios',
    )
    .setVersion('1.0.0')
    .addBearerAuth(SWAGGER_AUTH, 'access-token')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, document);
  }

  app.enableCors();
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    'No se pudo iniciar la aplicación',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
