import { Resend } from 'resend';
import { Injectable } from '@nestjs/common';

/**
 * Envío de correos (Resend).
 *
 * Las plantillas están maquetadas con tablas y estilos en línea —la forma en
 * que se construyen los correos que se ven bien en Gmail, Outlook y Apple Mail—
 * para que una invitación transmita confianza y parezca de un remitente serio.
 *
 * El acento de la marca es el verde de Appuntao. El logo se muestra como un
 * wordmark de texto por defecto (no depende de ninguna imagen alojada, que es
 * la causa más común de correos "rotos"); si se define `LOGO_URL` con una URL
 * pública del logo, se usa esa imagen en su lugar.
 *
 * El protagonista del correo es el **código**: el usuario lo teclea dentro de
 * la app para unirse. El enlace antiguo apuntaba a un frontend web inexistente,
 * así que aquí el código es el llamado a la acción, no un botón muerto.
 */
@Injectable()
export class EmailProvider {
  private resend = new Resend(process.env.RESEND_API_KEY);
  private from = process.env.EMAIL_FROM || 'APPUNTAO <onboarding@resend.dev>';
  private logoUrl = process.env.LOGO_URL;

  private readonly brand = '#00B26B';
  private readonly ink = '#0B0F14';
  private readonly muted = '#5B6672';
  private readonly pageBg = '#F4F6F8';

  private readonly roleLabelEs: Record<string, string> = {
    OWNER: 'Dueño',
    ADMIN: 'Administrador',
    CASHIER: 'Cajero',
    VIEWER: 'Solo lectura',
  };

  async sendDebtorInvitation(to: string, code: string, businessName: string) {
    const html = this.renderInvitation({
      heading: `Consulta tus deudas en ${businessName}`,
      intro: `El negocio <strong>${businessName}</strong> te invita a ver tus vales y saldos en Appuntao. Usa este código dentro de la app.`,
      code,
      steps: [
        'Instala Appuntao e ingresa con tu cuenta.',
        'Ve a <strong>Perfil &rarr; Tengo un c&oacute;digo</strong>.',
        'Escribe el c&oacute;digo de arriba.',
      ],
    });

    const text = this.renderInvitationText({
      heading: `Consulta tus deudas en ${businessName}`,
      intro: `El negocio ${businessName} te invita a ver tus vales y saldos en Appuntao.`,
      code,
    });

    return this.resend.emails.send({
      from: this.from,
      to,
      subject: `Consulta tus deudas en ${businessName}`,
      html,
      text,
    });
  }

  async sendBusinessInvitation(
    to: string,
    code: string,
    businessName: string,
    role: string,
  ) {
    const roleLabel = this.roleLabelEs[role] ?? role;

    const html = this.renderInvitation({
      heading: `Te invitaron a ${businessName}`,
      intro: `Te dieron acceso al equipo de <strong>${businessName}</strong> en Appuntao como <strong>${roleLabel}</strong>. Usa este c&oacute;digo dentro de la app para unirte.`,
      code,
      badge: roleLabel,
      steps: [
        'Instala Appuntao e ingresa con tu cuenta.',
        'Ve a <strong>Perfil &rarr; Tengo un c&oacute;digo</strong>.',
        'Escribe el c&oacute;digo de arriba y listo.',
      ],
    });

    const text = this.renderInvitationText({
      heading: `Te invitaron a trabajar en ${businessName}`,
      intro: `Te dieron acceso al equipo de ${businessName} en Appuntao como ${roleLabel}.`,
      code,
    });

    return this.resend.emails.send({
      from: this.from,
      to,
      subject: `Invitación para unirte a ${businessName} en Appuntao`,
      html,
      text,
    });
  }

  /* ── Plantilla ────────────────────────────────────────────────────────── */

  /** Cabecera de marca: logo alojado si hay `LOGO_URL`, si no, el wordmark. */
  private brandMark(): string {
    if (this.logoUrl) {
      return `<img src="${this.logoUrl}" alt="Appuntao" height="32" style="height:32px;display:block;border:0;outline:none;text-decoration:none;" />`;
    }
    return `<span style="font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">Appuntao</span>`;
  }

  private renderInvitation(opts: {
    heading: string;
    intro: string;
    code: string;
    steps: string[];
    badge?: string;
  }): string {
    const badge = opts.badge
      ? `<span style="display:inline-block;background-color:#E6F7EF;color:${this.brand};font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.3px;padding:6px 12px;border-radius:999px;">${opts.badge}</span>`
      : '';

    const steps = opts.steps
      .map(
        (step, index) =>
          `<tr>
            <td valign="top" style="padding:4px 10px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:${this.brand};">${index + 1}.</td>
            <td valign="top" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:22px;color:${this.ink};">${step}</td>
          </tr>`,
      )
      .join('');

    return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
  </head>
  <body style="margin:0;padding:0;background-color:${this.pageBg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${this.pageBg};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background-color:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 28px rgba(11,15,20,0.08);">
            <tr>
              <td style="background-color:${this.brand};padding:26px 32px;text-align:center;">
                ${this.brandMark()}
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                ${badge ? `<div style="margin-bottom:14px;">${badge}</div>` : ''}
                <h1 style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:800;color:${this.ink};">${opts.heading}</h1>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:${this.muted};">${opts.intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4FBF7;border:1px solid #CDEBDC;border-radius:16px;">
                  <tr>
                    <td style="padding:20px;text-align:center;">
                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${this.muted};">Tu código</div>
                      <div style="margin-top:8px;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:${this.ink};">${opts.code.toUpperCase()}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 8px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${steps}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 28px 32px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${this.muted};">El código vence en 7 días. Si no esperabas esta invitación, puedes ignorar este correo.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #EEF1F4;text-align:center;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#9AA4AE;">Appuntao · Lleva el control de tus fiados</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }

  /** Versión de texto plano (mejora la entregabilidad y evita el spam). */
  private renderInvitationText(opts: {
    heading: string;
    intro: string;
    code: string;
  }): string {
    return [
      opts.heading,
      '',
      opts.intro,
      '',
      `Tu código: ${opts.code.toUpperCase()}`,
      '',
      'Cómo unirte:',
      '1. Instala Appuntao e ingresa con tu cuenta.',
      '2. Ve a Perfil → Tengo un código.',
      '3. Escribe el código de arriba.',
      '',
      'El código vence en 7 días. Si no esperabas esta invitación, ignora este correo.',
      '',
      'Appuntao · Lleva el control de tus fiados',
    ].join('\n');
  }
}
