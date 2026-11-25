import { Resend } from 'resend';
import { Injectable } from '@nestjs/common';
import { ROLE_LABELS } from 'src/invitations/invitation.constants';

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

  async sendDebtorInvitation(
    to: string,
    code: string,
    businessName: string,
    expiresInDays: number,
  ) {
    // El nombre lo escribe el dueño del negocio: crudo en el HTML, un nombre
    // como `<a href="...">` metía un enlace en un correo que sale de nuestro
    // dominio.
    const business = escapeHtml(businessName);
    const html = this.renderInvitation({
      heading: `Consulta tus deudas en ${business}`,
      intro: `El negocio <strong>${business}</strong> te invita a ver tus vales y saldos en Appuntao. Usa este código dentro de la app.`,
      code,
      steps: [
        'Instala Appuntao e inicia sesi&oacute;n, o crea tu cuenta <strong>con este mismo correo</strong>.',
        'Toca &laquo;Aceptar&raquo; en la invitaci&oacute;n que te aparece en la app.',
        'Escribe el c&oacute;digo de arriba para confirmar que eres t&uacute;.',
      ],
      expiresInDays,
    });

    const text = this.renderInvitationText({
      heading: `Consulta tus deudas en ${businessName}`,
      intro: `El negocio ${businessName} te invita a ver tus vales y saldos en Appuntao.`,
      code,
      expiresInDays,
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
    expiresInDays: number,
  ) {
    const roleName = ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role;
    const roleLabel = escapeHtml(roleName);
    const business = escapeHtml(businessName);

    const html = this.renderInvitation({
      heading: `Te invitaron a ${business}`,
      intro: `Te dieron acceso al equipo de <strong>${business}</strong> en Appuntao como <strong>${roleLabel}</strong>. Usa este c&oacute;digo dentro de la app para unirte.`,
      code,
      badge: roleLabel,
      steps: [
        'Instala Appuntao e inicia sesi&oacute;n, o crea tu cuenta <strong>con este mismo correo</strong>.',
        'Toca &laquo;Aceptar&raquo; en la invitaci&oacute;n que te aparece en la app.',
        'Escribe el c&oacute;digo de arriba para confirmar que eres t&uacute;.',
      ],
      expiresInDays,
    });

    const text = this.renderInvitationText({
      heading: `Te invitaron a trabajar en ${businessName}`,
      intro: `Te dieron acceso al equipo de ${businessName} en Appuntao como ${roleName}.`,
      code,
      expiresInDays,
    });

    return this.resend.emails.send({
      from: this.from,
      to,
      subject: `Invitación para unirte a ${businessName} en Appuntao`,
      html,
      text,
    });
  }

  /* ── Verificar el correo ──────────────────────────────────────────────── */

  async sendEmailVerificationCode(
    to: string,
    code: string,
    expiresInMinutes: number,
  ) {
    const html = this.renderInvitation({
      heading: 'Confirma tu correo',
      intro:
        'Para terminar de crear tu cuenta de Appuntao, confirma que este correo es tuyo. Escribe este c&oacute;digo en la app.',
      code,
      steps: [
        'En la app, escribe el c&oacute;digo de arriba.',
        'Inicia sesi&oacute;n con tu correo y tu contrase&ntilde;a.',
      ],
      footnote: `El c&oacute;digo vence en ${expiresInMinutes} minutos y solo sirve una vez. <strong>No se lo compartas a nadie</strong>: Appuntao nunca te lo va a pedir. Si no creaste una cuenta, ignora este correo.`,
    });

    const text = [
      'Confirma tu correo',
      '',
      'Para terminar de crear tu cuenta de Appuntao, confirma que este correo es tuyo. Escribe este código en la app.',
      '',
      `Tu código: ${code}`,
      '',
      `El código vence en ${expiresInMinutes} minutos y solo sirve una vez. No se lo compartas a nadie: Appuntao nunca te lo va a pedir.`,
      'Si no creaste una cuenta, ignora este correo.',
      '',
      'Appuntao · Lleva el control de tus fiados',
    ].join('\n');

    return this.resend.emails.send({
      from: this.from,
      to,
      subject: `${code} es tu código para confirmar tu correo en Appuntao`,
      html,
      text,
    });
  }

  /* ── Contraseña ───────────────────────────────────────────────────────── */

  async sendPasswordResetCode(
    to: string,
    code: string,
    expiresInMinutes: number,
  ) {
    const html = this.renderInvitation({
      heading: 'Cambia tu contrase&ntilde;a',
      intro:
        'Recibimos una solicitud para cambiar la contrase&ntilde;a de tu cuenta de Appuntao. Escribe este c&oacute;digo en la app.',
      code,
      steps: [
        'En la app, escribe el c&oacute;digo de arriba.',
        'Elige tu nueva contrase&ntilde;a.',
        'Inicia sesi&oacute;n con la nueva contrase&ntilde;a.',
      ],
      footnote: `El c&oacute;digo vence en ${expiresInMinutes} minutos y solo sirve una vez. <strong>No se lo compartas a nadie</strong>: Appuntao nunca te lo va a pedir. Si no fuiste t&uacute;, ignora este correo; tu contrase&ntilde;a no cambia.`,
    });

    const text = [
      'Cambia tu contraseña',
      '',
      'Recibimos una solicitud para cambiar la contraseña de tu cuenta de Appuntao. Escribe este código en la app.',
      '',
      `Tu código: ${code}`,
      '',
      `El código vence en ${expiresInMinutes} minutos y solo sirve una vez. No se lo compartas a nadie: Appuntao nunca te lo va a pedir.`,
      'Si no fuiste tú, ignora este correo; tu contraseña no cambia.',
      '',
      'Appuntao · Lleva el control de tus fiados',
    ].join('\n');

    return this.resend.emails.send({
      from: this.from,
      to,
      subject: `${code} es tu código para cambiar la contraseña de Appuntao`,
      html,
      text,
    });
  }

  /** Aviso de que la contraseña se cambió con un código del correo. */
  async sendPasswordChangedNotice(to: string) {
    const heading = 'Tu contraseña se cambió';
    const intro =
      'La contrase&ntilde;a de tu cuenta de Appuntao se cambi&oacute; con un c&oacute;digo enviado a este correo, y se cerraron las sesiones abiertas. Si fuiste t&uacute;, no tienes que hacer nada. <strong>Si no fuiste t&uacute;</strong>, cambia tu contrase&ntilde;a desde &laquo;&iquest;Olvidaste tu contrase&ntilde;a?&raquo; y revisa la seguridad de tu correo.';

    return this.resend.emails.send({
      from: this.from,
      to,
      subject: 'Tu contraseña de Appuntao se cambió',
      html: this.renderNotice({
        heading: 'Tu contrase&ntilde;a se cambi&oacute;',
        intro,
        footer:
          'Recibes este correo por la seguridad de tu cuenta de Appuntao.',
      }),
      text: [
        heading,
        '',
        'La contraseña de tu cuenta de Appuntao se cambió con un código enviado a este correo, y se cerraron las sesiones abiertas.',
        'Si fuiste tú, no tienes que hacer nada. Si no fuiste tú, cambia tu contraseña desde "¿Olvidaste tu contraseña?" y revisa la seguridad de tu correo.',
        '',
        'Appuntao',
      ].join('\n'),
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
    expiresInDays?: number;
    /** Reemplaza la nota de vencimiento de las invitaciones. */
    footnote?: string;
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
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:${this.muted};">${opts.footnote ?? `La invitación vence en ${opts.expiresInDays} días. Si no esperabas esta invitación, puedes ignorar este correo.`}</p>
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
    expiresInDays: number;
  }): string {
    return [
      opts.heading,
      '',
      opts.intro,
      '',
      `Tu código: ${opts.code.toUpperCase()}`,
      '',
      'Cómo unirte:',
      '1. Instala Appuntao e inicia sesión, o crea tu cuenta con este mismo correo.',
      '2. Toca "Aceptar" en la invitación que te aparece en la app.',
      '3. Escribe el código de arriba para confirmar que eres tú.',
      '',
      `La invitación vence en ${opts.expiresInDays} días. Si no esperabas esta invitación, ignora este correo.`,
      '',
      'Appuntao · Lleva el control de tus fiados',
    ].join('\n');
  }

  /* ── Avisos ───────────────────────────────────────────────────────────── */

  /**
   * Le avisa al dueño que el miembro respondió su propuesta de pasarle el
   * negocio. Sin esto, el dueño solo se enteraba si volvía a mirar la app.
   */
  async sendOwnershipTransferResponse(
    to: string,
    opts: { businessName: string; responderName: string; accepted: boolean },
  ) {
    const business = escapeHtml(opts.businessName);
    const responder = escapeHtml(opts.responderName);
    const heading = opts.accepted
      ? `${opts.responderName} aceptó quedarse con ${opts.businessName}`
      : `${opts.responderName} rechazó quedarse con ${opts.businessName}`;
    const intro = opts.accepted
      ? `<strong>${responder}</strong> aceptó tu propuesta: ahora es el dueño de <strong>${business}</strong> y tú quedaste como administrador.`
      : `<strong>${responder}</strong> rechazó tu propuesta. <strong>${business}</strong> sigue siendo tuyo; si quieres, puedes proponérselo a alguien más desde la app.`;
    const introText = opts.accepted
      ? `${opts.responderName} aceptó tu propuesta: ahora es el dueño de ${opts.businessName} y tú quedaste como administrador.`
      : `${opts.responderName} rechazó tu propuesta. ${opts.businessName} sigue siendo tuyo; si quieres, puedes proponérselo a alguien más desde la app.`;

    return this.resend.emails.send({
      from: this.from,
      to,
      subject: heading,
      html: this.renderNotice({
        heading: escapeHtml(heading),
        intro,
        footer:
          'Recibes este correo porque propusiste pasar un negocio en Appuntao.',
      }),
      text: [heading, '', introText, '', 'Appuntao'].join('\n'),
    });
  }

  /** Correo informativo, sin código: misma cabecera y pie que las invitaciones. */
  private renderNotice(opts: {
    heading: string;
    intro: string;
    footer: string;
  }): string {
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
              <td style="padding:32px 32px 28px 32px;">
                <h1 style="margin:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:800;color:${this.ink};">${opts.heading}</h1>
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:${this.muted};">${opts.intro}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #EEF1F4;text-align:center;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#9AA4AE;">${opts.footer}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  }
}

/**
 * Los nombres los escriben los usuarios: no se insertan crudos en el HTML.
 * Todo texto que venga de un usuario (nombre de negocio, de persona) pasa por
 * aquí antes de entrar a una plantilla.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
