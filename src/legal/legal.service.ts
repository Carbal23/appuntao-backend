import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LegalAudience, LegalDocument, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import type { RequestContext } from 'src/auth-log/auth-log.types';

/** Un documento vigente con los datos de su tipo, tal como lo ve la app. */
export interface CurrentLegalDocument extends LegalDocument {
  title: string;
  audience: LegalAudience;
  required: boolean;
}

/** Qué se rechaza cuando falta un documento, según para qué se exige. */
const UNAVAILABLE_MESSAGE: Record<LegalAudience, string> = {
  ALL_USERS:
    'No hay documentos legales vigentes publicados. No es posible registrarse en este momento.',
  BUSINESS_OWNERS:
    'No hay documentos legales vigentes publicados para negocios. No es posible crear negocios en este momento.',
};

@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * La versión vigente de cada tipo activo del catálogo es la más reciente ya
   * publicada. Un tipo activo sin ninguna versión publicada no aparece.
   */
  async getCurrentDocuments(
    audience?: LegalAudience,
  ): Promise<CurrentLegalDocument[]> {
    const kinds = await this.findActiveKinds(audience);

    return kinds.flatMap(({ title, audience, required, documents }) =>
      documents.map((doc) => ({ ...doc, title, audience, required })),
    );
  }

  /**
   * Documentos obligatorios vigentes que el usuario todavía no ha aceptado.
   * Los de negocios solo se le piden a quien tiene un negocio activo.
   */
  async getPendingDocuments(userId: string): Promise<CurrentLegalDocument[]> {
    const ownsBusiness = await this.prisma.business.count({
      where: { ownerId: userId, inactivatedAt: null },
    });

    const current = (await this.getCurrentDocuments()).filter(
      (doc) =>
        doc.required &&
        (doc.audience === LegalAudience.ALL_USERS || ownsBusiness > 0),
    );
    if (!current.length) return [];

    const acceptedIds = await this.acceptedIds(
      userId,
      current.map((doc) => doc.id),
    );
    return current.filter((doc) => !acceptedIds.has(doc.id));
  }

  /**
   * Antes de registrarse (ALL_USERS) o de crear un negocio (BUSINESS_OWNERS)
   * hay que aceptar la versión vigente de cada documento obligatorio de ese
   * público. Si el frontend envía una versión vieja (por ejemplo, porque se
   * publicó una nueva mientras el usuario llenaba el formulario), se rechaza
   * para que vuelva a mostrar el texto actual.
   *
   * Con `userId`, lo que el usuario ya había aceptado no hace falta enviarlo
   * de nuevo (por ejemplo, al crear su segundo negocio).
   */
  async assertAcceptsCurrent(
    documentIds: string[],
    audience: LegalAudience,
    userId?: string,
  ): Promise<void> {
    const kinds = await this.findActiveKinds(audience);

    if (kinds.some((kind) => kind.required && !kind.documents.length)) {
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE[audience]);
    }

    const current = kinds.flatMap((kind) =>
      kind.documents.map((doc) => ({ ...doc, required: kind.required })),
    );
    const currentIds = new Set(current.map((doc) => doc.id));
    if (documentIds.some((id) => !currentIds.has(id))) {
      throw new BadRequestException(
        'Uno de los documentos no corresponde a la versión vigente. Vuelve a cargar los documentos.',
      );
    }

    const alreadyAccepted = userId
      ? await this.acceptedIds(
          userId,
          current.map((doc) => doc.id),
        )
      : new Set<string>();

    const missing = current.filter(
      (doc) =>
        doc.required &&
        !documentIds.includes(doc.id) &&
        !alreadyAccepted.has(doc.id),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Debes aceptar la versión vigente de: ${kinds
          .filter((kind) => missing.some((doc) => doc.type === kind.code))
          .map((kind) => kind.title)
          .join(', ')}.`,
      );
    }
  }

  /** Registra las aceptaciones. Si alguna ya existía, se ignora. */
  async recordConsents(
    db: Prisma.TransactionClient,
    userId: string,
    documentIds: string[],
    context?: RequestContext,
  ): Promise<void> {
    if (!documentIds.length) return;

    await db.userConsent.createMany({
      data: documentIds.map((documentId) => ({
        userId,
        documentId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      })),
      skipDuplicates: true,
    });
  }

  /** Aceptación de documentos pendientes por un usuario ya registrado. */
  async acceptDocuments(
    userId: string,
    documentIds: string[],
    context?: RequestContext,
  ): Promise<CurrentLegalDocument[]> {
    const current = await this.getCurrentDocuments();
    const currentIds = new Set(current.map((doc) => doc.id));

    if (documentIds.some((id) => !currentIds.has(id))) {
      throw new BadRequestException(
        'Uno de los documentos no corresponde a la versión vigente. Vuelve a cargar los documentos.',
      );
    }

    await this.recordConsents(this.prisma, userId, documentIds, context);

    return this.getPendingDocuments(userId);
  }

  /** Tipos activos, en su orden, cada uno con su versión vigente (o ninguna). */
  private findActiveKinds(audience?: LegalAudience) {
    return this.prisma.legalDocumentKind.findMany({
      where: { active: true, ...(audience ? { audience } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: {
        documents: {
          where: { publishedAt: { lte: new Date() } },
          orderBy: { publishedAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  private async acceptedIds(
    userId: string,
    documentIds: string[],
  ): Promise<Set<string>> {
    const accepted = await this.prisma.userConsent.findMany({
      where: { userId, documentId: { in: documentIds } },
      select: { documentId: true },
    });
    return new Set(accepted.map((consent) => consent.documentId));
  }
}
