import { EmailProvider, escapeHtml } from './email.provider';

type SentEmail = { to: string; subject: string; html: string; text: string };

/** EmailProvider con Resend reemplazado: guarda lo que se iba a enviar. */
function createProvider() {
  process.env.RESEND_API_KEY ??= 're_test';
  const provider = new EmailProvider();
  const send = jest.fn((email: SentEmail) =>
    Promise.resolve({ data: { id: 'email-id' }, error: null, email }),
  );
  Object.assign(provider, { resend: { emails: { send } } });
  const lastEmail = () => send.mock.calls.at(-1)![0];
  return { provider, send, lastEmail };
}

const MALICIOUS_NAME = '<a href="https://phishing.test">Verifica tu cuenta</a>';

describe('escapeHtml', () => {
  it('escapa los caracteres que abren etiquetas o atributos', () => {
    expect(escapeHtml(`<b>"Tienda" & 'Cia'</b>`)).toBe(
      '&lt;b&gt;&quot;Tienda&quot; &amp; &#39;Cia&#39;&lt;/b&gt;',
    );
  });

  it('deja igual un texto sin caracteres especiales', () => {
    expect(escapeHtml('Tienda Doña Rosa')).toBe('Tienda Doña Rosa');
  });
});

describe('EmailProvider', () => {
  describe('sendDebtorInvitation', () => {
    it('no inserta HTML crudo del nombre del negocio', async () => {
      const { provider, lastEmail } = createProvider();

      await provider.sendDebtorInvitation(
        'cliente@test.com',
        'ABCDE23456',
        MALICIOUS_NAME,
        7,
      );

      const { html } = lastEmail();
      expect(html).not.toContain('<a href="https://phishing.test">');
      expect(html).toContain(escapeHtml(MALICIOUS_NAME));
    });

    it('lleva el nombre tal cual en el asunto y en el texto plano', async () => {
      const { provider, lastEmail } = createProvider();

      await provider.sendDebtorInvitation(
        'cliente@test.com',
        'ABCDE23456',
        'Tienda & Cia',
        7,
      );

      const { subject, text } = lastEmail();
      expect(subject).toBe('Consulta tus deudas en Tienda & Cia');
      expect(text).toContain('Tienda & Cia');
    });
  });

  describe('sendBusinessInvitation', () => {
    it('no inserta HTML crudo del nombre del negocio', async () => {
      const { provider, lastEmail } = createProvider();

      await provider.sendBusinessInvitation(
        'cajero@test.com',
        'ABCDE23456',
        MALICIOUS_NAME,
        'CASHIER',
        7,
      );

      const { html, text } = lastEmail();
      expect(html).not.toContain('<a href="https://phishing.test">');
      expect(html).toContain('Cajero');
      expect(text).toContain('como Cajero');
    });
  });

  describe('sendOwnershipTransferResponse', () => {
    it('escapa el nombre del negocio y el de quien responde', async () => {
      const { provider, lastEmail } = createProvider();

      await provider.sendOwnershipTransferResponse('owner@test.com', {
        businessName: MALICIOUS_NAME,
        responderName: '<script>x</script>',
        accepted: true,
      });

      const { html } = lastEmail();
      expect(html).not.toContain('<a href="https://phishing.test">');
      expect(html).not.toContain('<script>');
    });
  });
});
