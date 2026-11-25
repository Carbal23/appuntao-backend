import { BusinessUserRole } from '@prisma/client';
import { canManageRole } from './team-rules';

const { OWNER, ADMIN, CASHIER, VIEWER } = BusinessUserRole;

describe('canManageRole', () => {
  it.each([
    [OWNER, ADMIN, true],
    [OWNER, CASHIER, true],
    [OWNER, VIEWER, true],
    [OWNER, OWNER, false],
    [ADMIN, CASHIER, true],
    [ADMIN, VIEWER, true],
    [ADMIN, ADMIN, false],
    [ADMIN, OWNER, false],
    [CASHIER, VIEWER, false],
    [CASHIER, CASHIER, false],
    [VIEWER, VIEWER, false],
  ])('%s maneja a %s: %s', (actor, target, expected) => {
    expect(canManageRole(actor, target)).toBe(expected);
  });

  it('nadie asigna OWNER: la propiedad solo cambia por transferencia', () => {
    for (const actor of Object.values(BusinessUserRole)) {
      expect(canManageRole(actor, OWNER)).toBe(false);
    }
  });

  it('sin rol (no es miembro) no maneja a nadie', () => {
    expect(canManageRole(null, VIEWER)).toBe(false);
    expect(canManageRole(undefined, VIEWER)).toBe(false);
  });
});
