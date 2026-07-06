import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

/**
 * Direcciones seguras a las que se redirige TODO email saliente cuando
 * la variable de entorno EMAIL_REDIRECT_TO está definida (separadas por coma).
 *
 * Mecanismo de seguridad para entornos que NO son producción (ej. TFI): garantiza
 * que ningún correo llegue jamás a usuarios reales del cliente. Los destinatarios
 * originales solo se conservan como referencia en el asunto del mensaje.
 */
const REDIRECT_TO = (process.env.EMAIL_REDIRECT_TO ?? '')
  .split(',')
  .map(dir => dir.trim())
  .filter(Boolean)

export const EMAIL_REDIRECT_ACTIVE = REDIRECT_TO.length > 0

if (EMAIL_REDIRECT_ACTIVE) {
  console.log(
    `🛡️  MODO EMAIL SEGURO ACTIVO: todos los correos se redirigen a ${REDIRECT_TO.join(
      ', ',
    )}. No se enviará ningún email a usuarios reales.`,
  )
}

interface MailOptions {
  from: string
  to: string | string[]
  subject: string
  html: string
}

/**
 * Único punto de salida de correos de la aplicación. Cuando el modo seguro está
 * activo, fuerza el destinatario a las direcciones de EMAIL_REDIRECT_TO en lugar
 * de las direcciones reales calculadas por la lógica de negocio.
 */
export async function sendMail(opts: MailOptions) {
  if (EMAIL_REDIRECT_ACTIVE) {
    const destinatarioOriginal = Array.isArray(opts.to) ? opts.to.join(', ') : opts.to
    return resend.emails.send({
      from: opts.from,
      to: REDIRECT_TO,
      subject: `[TFI · original → ${destinatarioOriginal}] ${opts.subject}`,
      html: opts.html,
    })
  }

  return resend.emails.send(opts)
}
