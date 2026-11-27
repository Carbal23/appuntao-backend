import { INestApplication, ValidationPipe } from '@nestjs/common';

/**
 * Lo que `main.ts` le pone a la aplicación y que las pruebas por HTTP
 * necesitan igual: el prefijo `/api` y la validación de los DTOs. Así una
 * prueba no puede pasar con una configuración distinta a la real.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
