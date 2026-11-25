import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessUserRole } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { BusinessContextGuard } from './business-context.guard';
import { BusinessRoleGuard } from './business-role.guard';

const BUSINESS_ID = 'business-1';
const USER_ID = 'user-1';

type Row = { inactivatedAt: Date | null; role: BusinessUserRole | null };

/** Prisma de mentira; `queryRaw` es la consulta que comparten los guards. */
function createPrisma(rows: Row[]) {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return Object.assign(prisma, { queryRaw });
}

function createContext(request: Record<string, unknown>): ExecutionContext {
  const handler = () => undefined;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function createRequest(businessId: string | null = BUSINESS_ID) {
  return {
    user: { id: USER_ID, role: 'USER' },
    headers: businessId ? { 'x-business-id': businessId } : {},
    params: {},
    query: {},
  };
}

function reflectorWith(roles?: BusinessUserRole[]) {
  return { getAllAndOverride: () => roles } as unknown as Reflector;
}

describe('BusinessContextGuard', () => {
  it('deja pasar a un miembro de un negocio activo', async () => {
    const prisma = createPrisma([
      { inactivatedAt: null, role: BusinessUserRole.CASHIER },
    ]);
    const request = createRequest();

    await expect(
      new BusinessContextGuard(prisma).canActivate(createContext(request)),
    ).resolves.toBe(true);
    expect(request).toMatchObject({
      business: { id: BUSINESS_ID, inactivatedAt: null },
    });
  });

  it('responde 404 si el negocio no existe', async () => {
    const guard = new BusinessContextGuard(createPrisma([]));

    await expect(
      guard.canActivate(createContext(createRequest())),
    ).rejects.toThrow(NotFoundException);
  });

  it('responde 400 si el negocio está cerrado', async () => {
    const guard = new BusinessContextGuard(
      createPrisma([
        { inactivatedAt: new Date(), role: BusinessUserRole.OWNER },
      ]),
    );

    await expect(
      guard.canActivate(createContext(createRequest())),
    ).rejects.toThrow(BadRequestException);
  });

  it('responde 403 si el usuario no es miembro', async () => {
    const guard = new BusinessContextGuard(
      createPrisma([{ inactivatedAt: null, role: null }]),
    );

    await expect(
      guard.canActivate(createContext(createRequest())),
    ).rejects.toThrow(ForbiddenException);
  });

  it('responde 403 si no se indica el negocio', async () => {
    const guard = new BusinessContextGuard(createPrisma([]));

    await expect(
      guard.canActivate(createContext(createRequest(null))),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('BusinessRoleGuard', () => {
  it('deja pasar sin @BusinessRoles y sin consultar la base', async () => {
    const prisma = createPrisma([]);
    const guard = new BusinessRoleGuard(reflectorWith(undefined), prisma);

    await expect(
      guard.canActivate(createContext(createRequest())),
    ).resolves.toBe(true);
    expect(prisma.queryRaw).not.toHaveBeenCalled();
  });

  it('deja pasar un rol permitido', async () => {
    const guard = new BusinessRoleGuard(
      reflectorWith([BusinessUserRole.OWNER, BusinessUserRole.ADMIN]),
      createPrisma([{ inactivatedAt: null, role: BusinessUserRole.ADMIN }]),
    );

    await expect(
      guard.canActivate(createContext(createRequest())),
    ).resolves.toBe(true);
  });

  it('responde 403 con un rol que no está permitido', async () => {
    const guard = new BusinessRoleGuard(
      reflectorWith([BusinessUserRole.OWNER, BusinessUserRole.ADMIN]),
      createPrisma([{ inactivatedAt: null, role: BusinessUserRole.CASHIER }]),
    );

    await expect(
      guard.canActivate(createContext(createRequest())),
    ).rejects.toThrow('Permisos insuficientes para este negocio');
  });

  it('responde 403 si el usuario no es miembro', async () => {
    const guard = new BusinessRoleGuard(
      reflectorWith([BusinessUserRole.VIEWER]),
      createPrisma([{ inactivatedAt: null, role: null }]),
    );

    await expect(
      guard.canActivate(createContext(createRequest())),
    ).rejects.toThrow('El usuario no pertenece a este negocio');
  });
});

describe('los dos guards juntos', () => {
  it('consultan la base una sola vez por petición', async () => {
    const prisma = createPrisma([
      { inactivatedAt: null, role: BusinessUserRole.OWNER },
    ]);
    const context = createContext(createRequest());

    await new BusinessContextGuard(prisma).canActivate(context);
    await new BusinessRoleGuard(
      reflectorWith([BusinessUserRole.OWNER]),
      prisma,
    ).canActivate(context);

    expect(prisma.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('también cuando el guard de roles corre primero', async () => {
    const prisma = createPrisma([
      { inactivatedAt: null, role: BusinessUserRole.ADMIN },
    ]);
    const context = createContext(createRequest());

    await new BusinessRoleGuard(
      reflectorWith([BusinessUserRole.ADMIN]),
      prisma,
    ).canActivate(context);
    await new BusinessContextGuard(prisma).canActivate(context);

    expect(prisma.queryRaw).toHaveBeenCalledTimes(1);
  });
});
