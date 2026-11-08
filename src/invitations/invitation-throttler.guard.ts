import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Limita cuántas invitaciones crea cada negocio, sin importar desde qué
 * dispositivo: evita que APPUNTAO se use para enviar correos masivos, lo que
 * dañaría la reputación del dominio de envío.
 */
@Injectable()
export class InvitationThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const headers = req.headers as Record<string, string | undefined>;
    return Promise.resolve(`invitations:${headers['x-business-id'] ?? 'none'}`);
  }
}
