import accountConfig from './account.config';

describe('account.config', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  const requireEmailVerification = (
    env: Record<string, string | undefined>,
  ) => {
    process.env = { ...original, ...env };
    return accountConfig().requireEmailVerification;
  };

  describe('requireEmailVerification', () => {
    it('en production se exige siempre, aunque la variable diga false', () => {
      expect(
        requireEmailVerification({
          NODE_ENV: 'production',
          REQUIRE_EMAIL_VERIFICATION: 'false',
        }),
      ).toBe(true);
      expect(
        requireEmailVerification({
          NODE_ENV: 'production',
          REQUIRE_EMAIL_VERIFICATION: undefined,
        }),
      ).toBe(true);
    });

    it.each(['local', 'development'])(
      'en %s está apagada por defecto',
      (nodeEnv) => {
        expect(
          requireEmailVerification({
            NODE_ENV: nodeEnv,
            REQUIRE_EMAIL_VERIFICATION: undefined,
          }),
        ).toBe(false);
      },
    );

    it('fuera de production se enciende con REQUIRE_EMAIL_VERIFICATION=true', () => {
      expect(
        requireEmailVerification({
          NODE_ENV: 'development',
          REQUIRE_EMAIL_VERIFICATION: 'true',
        }),
      ).toBe(true);
    });
  });
});
