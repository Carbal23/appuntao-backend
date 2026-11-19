import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { extractBusinessId } from 'src/common/utils/BusinessId.util';

/**
 * Limita cuántas invitaciones crea cada negocio, sin importar desde qué
 * dispositivo: evita que Appuntao se use para enviar correos masivos, lo que
 * dañaría la reputación del dominio de envío.
 */
@Injectable()
export class InvitationThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    // El mismo criterio que BusinessContextGuard (header, ruta o query), que
    // corre antes y garantiza que el negocio existe.
    const businessId = extractBusinessId(req as Request) ?? 'none';
    return Promise.resolve(`invitations:${businessId}`);
  }
}
