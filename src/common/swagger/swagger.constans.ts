import type { DocumentBuilder } from '@nestjs/swagger';

// El tipo se toma de la API pública: desde @nestjs/swagger 11.4.8 el paquete
// declara `exports` y ya no deja importar archivos de `dist/`.
type SecuritySchemeObject = NonNullable<
  Parameters<DocumentBuilder['addBearerAuth']>[0]
>;

export const SWAGGER_AUTH: SecuritySchemeObject = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description: 'Ingresa el token JWT',
};
