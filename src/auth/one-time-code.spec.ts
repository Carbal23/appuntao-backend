import { createCodeHasher, generateCode } from './one-time-code';

const SECRET = 'x'.repeat(32);

describe('generateCode', () => {
  it('genera 6 dígitos, con ceros a la izquierda', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('createCodeHasher', () => {
  it('reconoce el código correcto y rechaza otro', () => {
    const codes = createCodeHasher(SECRET, 'email-verification-code');
    const hash = codes.hash('123456');

    expect(codes.matches('123456', hash)).toBe(true);
    expect(codes.matches('123457', hash)).toBe(false);
  });

  it('nunca guarda el código en claro', () => {
    const codes = createCodeHasher(SECRET, 'email-verification-code');

    expect(codes.hash('123456')).not.toContain('123456');
  });

  it('un código de un propósito no sirve para el otro', () => {
    const reset = createCodeHasher(SECRET, 'password-reset-code');
    const verify = createCodeHasher(SECRET, 'email-verification-code');

    expect(verify.matches('123456', reset.hash('123456'))).toBe(false);
  });

  it('un hash con otro largo no lanza: solo no coincide', () => {
    const codes = createCodeHasher(SECRET, 'password-reset-code');

    expect(codes.matches('123456', 'abcd')).toBe(false);
  });
});
