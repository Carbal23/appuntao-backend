import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Invitation,
  InvitationStatus,
  InvitationType,
  Prisma,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { EmailProvider } from 'src/providers/email.provider';
import { AuditService } from 'src/audit/audit.service';
import { AuditAction } from 'src/audit/audit.types';
import type { UserSafe } from 'src/users/user.select';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { ListInvitationsQueryDto } from './dto/list-invitations-query.dto';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  DEFAULT_EXPIRATION_DAYS,
  ROLE_LABELS,
} from './invitation.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lo que ve el negocio: incluye el código, para compartirlo. */
const businessView = {
  id: true,
  type: true,
  role: true,
  status: true,
  email: true,
  phone: true,
  code: true,
  expiresAt: true,
  respondedAt: true,
  createdAt: true,
  debtor: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  acceptedBy: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.InvitationSelect;

/** Lo que ve la persona invitada: sin código ni datos de otros. */
const recipientView = {
  id: true,
  type: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  business: { select: { id: true, name: true } },
  debtor: { select: { name: true } },
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.InvitationSelect;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailProvider: EmailProvider,
    private readonly auditService: AuditService,
  ) {}

  // ------------------------------------------------------ lado del negocio

  async create(
    dto: CreateInvitationDto,
    businessId: string,
    creatorId: string,
  ) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
    });
    if (!business) throw new NotFoundException('Negocio no encontrado');

    const email = dto.email;
    let phone = dto.phone;

    if (dto.type === InvitationType.BUSINESS_USER) {
      if (!dto.role) {
        throw new BadRequestException('Debes elegir el rol del empleado');
      }
      if (dto.debtorId) {
        throw new BadRequestException(
          'debtorId solo aplica a invitaciones de cliente (DEBTOR)',
        );
      }
    } else {
      if (!dto.debtorId) {
        throw new BadRequestException('Debes indicar el cliente (debtorId)');
      }
      if (dto.role) {
        throw new BadRequestException(
          'role solo aplica a invitaciones de empleado (BUSINESS_USER)',
        );
      }
      const debtor = await this.prisma.debtor.findFirst({
        where: { id: dto.debtorId, businessId },
      });
      if (!debtor) throw new NotFoundException('Cliente no encontrado');
      if (debtor.inactivatedAt) {
        throw new BadRequestException('El cliente está inactivo');
      }
      if (debtor.userId) {
        throw new ConflictException(
          'Este cliente ya está vinculado a una cuenta',
        );
      }
      // Si no se indica a quién enviarla, va al teléfono del cliente.
      if (!email && !phone) phone = debtor.phone ?? undefined;
    }

    if (!email && !phone) {
      throw new BadRequestException(
        'Indica el teléfono o el correo de la persona invitada',
      );
    }

    const target = this.targetConditions(email, phone);

    if (dto.type === InvitationType.BUSINESS_USER) {
      const alreadyMember = await this.prisma.businessUser.findFirst({
        where: { businessId, user: { OR: target } },
      });
      if (alreadyMember) {
        throw new ConflictException('Esta persona ya es miembro del negocio');
      }
    }

    const duplicate = await this.prisma.invitation.findFirst({
      where: {
        businessId,
        type: dto.type,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
        ...(dto.debtorId ? { debtorId: dto.debtorId } : {}),
        OR: target,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        statusCode: 409,
        error: 'INVITATION_ALREADY_PENDING',
        message:
          'Ya hay una invitación pendiente para esta persona. Puedes reenviarla.',
        invitationId: duplicate.id,
      });
    }

    const expiresInDays = dto.expiresInDays ?? DEFAULT_EXPIRATION_DAYS;
    const invitation = await this.prisma.invitation.create({
      data: {
        businessId,
        type: dto.type,
        role: dto.role,
        debtorId: dto.debtorId,
        email,
        phone,
        code: await this.uniqueCode(),
        createdById: creatorId,
        expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
      },
      select: businessView,
    });

    const emailSent = await this.sendEmail(
      invitation,
      business.name,
      expiresInDays,
    );

    await this.auditService.log({
      userId: creatorId,
      action: AuditAction.INVITATION_CREATED,
      entity: 'Invitation',
      entityId: invitation.id,
      meta: {
        businessId,
        type: invitation.type,
        role: invitation.role,
        byEmail: !!email,
        byPhone: !!phone,
      },
    });

    return {
      message: 'Invitación creada',
      invitation,
      emailSent,
      ...this.shareInfo(invitation, business.name),
    };
  }

  async listForBusiness(businessId: string, query: ListInvitationsQueryDto) {
    const { page = 1, limit = 10, status, type } = query;
    const where: Prisma.InvitationWhereInput = {
      businessId,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.invitation.findMany({
        where,
        select: businessView,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.invitation.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async cancel(id: string, businessId: string, actorId: string) {
    const invitation = await this.requireBusinessInvitation(id, businessId);
    this.assertPending(invitation);

    await this.close(invitation.id, InvitationStatus.CANCELLED);
    await this.auditService.log({
      userId: actorId,
      action: AuditAction.INVITATION_CANCELLED,
      entity: 'Invitation',
      entityId: id,
    });

    return { message: 'Invitación cancelada' };
  }

  /** Vuelve a enviar el correo y renueva la vigencia; el código no cambia. */
  async resend(id: string, businessId: string) {
    const existing = await this.requireBusinessInvitation(id, businessId);
    if (existing.status !== InvitationStatus.PENDING) {
      throw new ConflictException(
        'Solo se pueden reenviar invitaciones pendientes',
      );
    }

    const invitation = await this.prisma.invitation.update({
      where: { id },
      data: {
        expiresAt: new Date(Date.now() + DEFAULT_EXPIRATION_DAYS * DAY_MS),
      },
      select: { ...businessView, business: { select: { name: true } } },
    });
    const { business, ...rest } = invitation;

    const emailSent = await this.sendEmail(
      rest,
      business.name,
      DEFAULT_EXPIRATION_DAYS,
    );

    return {
      message: 'Invitación reenviada',
      invitation: rest,
      emailSent,
      ...this.shareInfo(rest, business.name),
    };
  }

  // ------------------------------------------------ lado de la persona invitada

  /** Invitaciones pendientes dirigidas al correo o teléfono del usuario. */
  async listIncoming(user: UserSafe) {
    const target = this.targetConditions(user.email, user.phone);
    if (!target.length) return [];

    return this.prisma.invitation.findMany({
      where: {
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
        business: { inactivatedAt: null },
        OR: target,
      },
      select: recipientView,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Vista previa de una invitación por su código, solo para la persona invitada. */
  async previewByCode(code: string, user: UserSafe) {
    const invitation = await this.findByCode(code);
    this.assertUsable(invitation);
    this.assertRecipient(invitation, user);

    return this.prisma.invitation.findUnique({
      where: { id: invitation.id },
      select: recipientView,
    });
  }

  acceptByCode(code: string, user: UserSafe) {
    return this.findByCode(code).then((invitation) =>
      this.accept(invitation, user),
    );
  }

  async acceptById(id: string, user: UserSafe) {
    return this.accept(await this.requireInvitation(id), user);
  }

  async reject(id: string, user: UserSafe) {
    const invitation = await this.requireInvitation(id);
    this.assertUsable(invitation);
    this.assertRecipient(invitation, user);

    await this.close(invitation.id, InvitationStatus.REJECTED);
    await this.auditService.log({
      userId: user.id,
      action: AuditAction.INVITATION_REJECTED,
      entity: 'Invitation',
      entityId: id,
    });

    return { message: 'Invitación rechazada' };
  }

  private async accept(invitation: Invitation, user: UserSafe) {
    this.assertUsable(invitation);
    this.assertRecipient(invitation, user);

    const business = await this.prisma.business.findUnique({
      where: { id: invitation.businessId },
    });
    if (!business || business.inactivatedAt) {
      throw new BadRequestException('El negocio ya no está activo');
    }

    await this.prisma.$transaction(async (tx) => {
      // La condición de estado evita que dos peticiones acepten la misma
      // invitación a la vez.
      const { count } = await tx.invitation.updateMany({
        where: { id: invitation.id, status: InvitationStatus.PENDING },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedById: user.id,
          respondedAt: new Date(),
        },
      });
      if (count === 0) {
        throw new ConflictException('La invitación ya fue respondida');
      }

      if (invitation.type === InvitationType.DEBTOR) {
        const linked = await tx.debtor.updateMany({
          where: {
            id: invitation.debtorId!,
            businessId: invitation.businessId,
            userId: null,
            inactivatedAt: null,
          },
          data: { userId: user.id },
        });
        if (linked.count === 0) {
          throw new ConflictException(
            'Este registro de cliente ya está vinculado a otra cuenta o fue inactivado',
          );
        }
      } else {
        const isMember =
          business.ownerId === user.id ||
          (await tx.businessUser.findFirst({
            where: { businessId: business.id, userId: user.id },
          }));
        if (isMember) {
          throw new ConflictException('Ya eres miembro de este negocio');
        }
        await tx.businessUser.create({
          data: {
            businessId: business.id,
            userId: user.id,
            role: invitation.role!,
          },
        });
      }
    });

    await this.auditService.log({
      userId: user.id,
      action: AuditAction.INVITATION_ACCEPTED,
      entity: 'Invitation',
      entityId: invitation.id,
      meta: { type: invitation.type, businessId: invitation.businessId },
    });

    return {
      message:
        invitation.type === InvitationType.DEBTOR
          ? `Ahora puedes ver tus cuentas en ${business.name}`
          : `Te uniste a ${business.name} como ${ROLE_LABELS[invitation.role!]}`,
      businessId: business.id,
      type: invitation.type,
    };
  }

  // ---------------------------------------------------------- utilidades

  /** Condiciones para encontrar invitaciones o usuarios por correo o teléfono. */
  private targetConditions(
    email?: string | null,
    phone?: string | null,
  ): { email?: string; phone?: string }[] {
    return [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])];
  }

  /**
   * Solo puede aceptar o rechazar la persona a la que va dirigida: su correo
   * o su teléfono deben coincidir. Así un código reenviado o filtrado no le
   * sirve a nadie más.
   */
  private assertRecipient(invitation: Invitation, user: UserSafe) {
    const matches =
      (!!invitation.email && invitation.email === user.email) ||
      (!!invitation.phone && invitation.phone === user.phone);
    if (!matches) {
      throw new ForbiddenException(
        'Esta invitación fue enviada a otro teléfono o correo. Pide que te inviten con los datos de tu cuenta.',
      );
    }
  }

  private assertPending(invitation: Invitation) {
    if (invitation.status !== InvitationStatus.PENDING) {
      throw new ConflictException(
        'La invitación ya fue respondida o cancelada',
      );
    }
  }

  private assertUsable(invitation: Invitation) {
    this.assertPending(invitation);
    if (invitation.expiresAt <= new Date()) {
      void this.close(invitation.id, InvitationStatus.EXPIRED);
      throw new BadRequestException('La invitación venció');
    }
  }

  private async close(id: string, status: InvitationStatus) {
    await this.prisma.invitation.updateMany({
      where: { id, status: InvitationStatus.PENDING },
      data: { status, respondedAt: new Date() },
    });
  }

  private async findByCode(code: string) {
    // Las invitaciones anteriores tenían códigos en minúsculas.
    const invitation = await this.prisma.invitation.findFirst({
      where: { code: { equals: code, mode: 'insensitive' } },
    });
    if (!invitation) throw new NotFoundException('Código inválido');
    return invitation;
  }

  private async requireInvitation(id: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id },
    });
    if (!invitation) throw new NotFoundException('Invitación no encontrada');
    return invitation;
  }

  private async requireBusinessInvitation(id: string, businessId: string) {
    const invitation = await this.requireInvitation(id);
    if (invitation.businessId !== businessId) {
      throw new NotFoundException('Invitación no encontrada');
    }
    return invitation;
  }

  private async uniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from(
        { length: CODE_LENGTH },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join('');
      const taken = await this.prisma.invitation.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    throw new Error('No se pudo generar un código de invitación único');
  }

  /** Envía el correo si la invitación tiene correo. Un fallo no anula la invitación. */
  private async sendEmail(
    invitation: {
      type: InvitationType;
      role: Invitation['role'];
      email: string | null;
      code: string;
    },
    businessName: string,
    expiresInDays: number,
  ): Promise<boolean> {
    if (!invitation.email) return false;
    try {
      const result =
        invitation.type === InvitationType.DEBTOR
          ? await this.emailProvider.sendDebtorInvitation(
              invitation.email,
              invitation.code,
              businessName,
              expiresInDays,
            )
          : await this.emailProvider.sendBusinessInvitation(
              invitation.email,
              invitation.code,
              businessName,
              invitation.role!,
              expiresInDays,
            );
      if (result.error) {
        this.logger.error(
          `No se pudo enviar la invitación por correo: ${result.error.message}`,
        );
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(
        'No se pudo enviar la invitación por correo',
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * Mensaje listo para compartir (por ejemplo, desde el WhatsApp del dueño) y
   * enlace de WhatsApp si la invitación tiene teléfono. No requiere ninguna
   * integración paga: el dueño lo envía desde su propio teléfono.
   */
  private shareInfo(
    invitation: {
      type: InvitationType;
      role: Invitation['role'];
      phone: string | null;
      email: string | null;
      code: string;
    },
    businessName: string,
  ) {
    const registerWith = invitation.phone
      ? 'regístrate con este número'
      : 'regístrate con este correo';
    const purpose =
      invitation.type === InvitationType.DEBTOR
        ? 'a ver tus cuentas en FIAO'
        : `a unirte a su equipo en FIAO como ${ROLE_LABELS[invitation.role!]}`;

    const shareText = `Hola, ${businessName} te invita ${purpose}. Descarga FIAO, inicia sesión o ${registerWith}, y acepta la invitación que te aparece en la app. Si te pide un código, es: ${invitation.code}`;

    return {
      shareText,
      whatsappUrl: invitation.phone
        ? `https://wa.me/57${invitation.phone}?text=${encodeURIComponent(shareText)}`
        : null,
    };
  }
}
