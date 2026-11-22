import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SWAGGER_AUTH } from './common/swagger/swagger.constans';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Detrás de un proxy (Render, nginx…), la IP de la conexión es la del
  // proxy. TRUST_PROXY indica cuántos saltos de proxy creer para tomar la IP
  // real del cliente de X-Forwarded-For; sin ella, los límites de intentos y
  // los registros de seguridad verían a todos los usuarios con la misma IP.
  const trustProxy = Number(process.env.TRUST_PROXY);
  if (trustProxy > 0) app.set('trust proxy', trustProxy);
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

  // Content-Disposition se expone para que el frontend web pueda leer el
  // nombre de los archivos que descarga (por ejemplo, el Excel del negocio).
  app.enableCors({ exposedHeaders: ['Content-Disposition'] });
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  new Logger('Bootstrap').error(
    'No se pudo iniciar la aplicación',
    error instanceof Error ? error.stack : String(error),
  );
  process.exit(1);
});
