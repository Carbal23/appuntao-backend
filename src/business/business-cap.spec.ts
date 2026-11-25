import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertCanOwnAnotherBusiness,
  MAX_ACTIVE_OWNED_BUSINESSES,
} from './business-cap';

function createTx(activeBusinesses: number) {
  const queryRaw = jest.fn().mockResolvedValue([{ id: 'user-1' }]);
  const count = jest.fn().mockResolvedValue(activeBusinesses);
  const tx = {
    $queryRaw: queryRaw,
    business: { count },
  } as unknown as Prisma.TransactionClient;
  return Object.assign(tx, { queryRaw, count });
}

describe('assertCanOwnAnotherBusiness', () => {
  it('deja pasar por debajo del tope', async () => {
    const tx = createTx(MAX_ACTIVE_OWNED_BUSINESSES - 1);

    await expect(
      assertCanOwnAnotherBusiness(tx, 'user-1'),
    ).resolves.toBeUndefined();
  });

  it('rechaza al llegar al tope', async () => {
    const tx = createTx(MAX_ACTIVE_OWNED_BUSINESSES);

    await expect(assertCanOwnAnotherBusiness(tx, 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('usa el mensaje que recibe', async () => {
    const tx = createTx(MAX_ACTIVE_OWNED_BUSINESSES);

    await expect(
      assertCanOwnAnotherBusiness(tx, 'user-1', 'Mensaje propio'),
    ).rejects.toThrow('Mensaje propio');
  });

  it('bloquea al usuario antes de contar y solo cuenta negocios activos', async () => {
    const tx = createTx(0);

    await assertCanOwnAnotherBusiness(tx, 'user-1');

    const [sql] = tx.queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(tx.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.count.mock.invocationCallOrder[0],
    );
    expect(tx.count).toHaveBeenCalledWith({
      where: { ownerId: 'user-1', inactivatedAt: null },
    });
  });
});
