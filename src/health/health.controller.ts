import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from 'src/prisma/prisma.service';

/** Lo máximo que se espera a la base antes de responder que no está lista. */
export const DB_CHECK_TIMEOUT_MS = 3000;

/** Ver docs/modulos/health.md. */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Vivo: el proceso responde. No toca la base, para que una caída de la base
   * no haga que Render dé por fallido un despliegue o reinicie el servicio.
   */
  @Get()
  @ApiOperation({ summary: 'El servidor está arriba (no consulta la base)' })
  @ApiResponse({ status: 200, description: '{ status: "ok" }' })
  check() {
    return { status: 'ok' };
  }

  /**
   * Listo: el servidor responde y la base también. Es la ruta para el ping
   * que mantiene despierto el servicio: así también mantiene activa la base
   * (Supabase pausa los proyectos gratuitos que pasan una semana sin uso).
   */
  @Get('ready')
  @ApiOperation({ summary: 'El servidor y la base de datos responden' })
  @ApiResponse({ status: 200, description: '{ status: "ok", database: "ok" }' })
  @ApiResponse({ status: 503, description: 'La base no responde' })
  async ready() {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Tiempo de espera agotado')),
            DB_CHECK_TIMEOUT_MS,
          );
        }),
      ]);
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      this.logger.error(
        'La base de datos no responde',
        error instanceof Error ? error.message : String(error),
      );
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unavailable',
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
