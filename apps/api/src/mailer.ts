/**
 * Envoi des emails transactionnels. En développement et en test, les emails
 * sont journalisés et conservés en mémoire ; en production, `SmtpMailer`
 * envoie par le serveur SMTP configuré (messagerie OVH, Brevo…).
 */
import nodemailer, { type Transporter } from 'nodemailer';
export interface Email {
  to: string;
  subject: string;
  text: string;
  link?: string;
}

export interface Mailer {
  send(email: Email): Promise<void>;
}

export class MemoryMailer implements Mailer {
  outbox: Email[] = [];
  constructor(private log: (msg: string) => void = () => undefined) {}
  async send(email: Email): Promise<void> {
    this.outbox.push(email);
    this.log(`Email pour ${email.to} — ${email.subject}${email.link ? ` — ${email.link}` : ''}`);
  }
  last(to?: string): Email | undefined {
    return [...this.outbox].reverse().find((e) => !to || e.to === to);
  }
}

export const templates = {
  verify: (appUrl: string, token: string) => ({
    subject: 'Confirmez votre adresse pour Tréso Optimum',
    link: `${appUrl}/verification-email?token=${token}`,
    text: 'Bienvenue sur Tréso Optimum. Confirmez votre adresse pour accéder à votre trésorerie (lien valable 24 h).',
  }),
  magic: (appUrl: string, token: string) => ({
    subject: 'Votre lien de connexion à Tréso Optimum',
    link: `${appUrl}/connexion/lien?token=${token}`,
    text: 'Cliquez sur ce lien pour vous connecter (valable 15 minutes).',
  }),
  reset: (appUrl: string, token: string) => ({
    subject: 'Réinitialisez votre mot de passe Tréso Optimum',
    link: `${appUrl}/reinitialiser?token=${token}`,
    text: "Choisissez un nouveau mot de passe (lien valable 1 heure). Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.",
  }),
  invitation: (appUrl: string, token: string, inviter: string, company: string, role: string) => ({
    subject: `${inviter} vous invite sur Tréso Optimum`,
    link: `${appUrl}/invitation?token=${token}`,
    text: `${inviter} vous invite à rejoindre ${company} sur Tréso Optimum en tant que ${role}.`,
  }),
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Gabarit HTML sobre aux couleurs Optimum : bandeau pétrole, bouton orange. */
export function renderEmailHtml(email: Email, appUrl: string): string {
  const button = email.link
    ? `<p style="margin:28px 0"><a href="${esc(email.link)}" style="background:#E94F1C;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Ouvrir Tréso Optimum</a></p>
       <p style="font-size:12px;color:#5c5c5d">Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :<br><span style="word-break:break-all">${esc(email.link)}</span></p>`
    : '';
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f6f5;font-family:Raleway,Arial,sans-serif;color:#303031">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
      <tr><td style="background:#114C5C;padding:20px 28px;color:#ffffff;font-family:Poppins,Arial,sans-serif;font-size:22px;font-weight:600">opt<span style="color:#E94F1C">!</span>mum <span style="color:#84ADB7;font-weight:400">tréso</span></td></tr>
      <tr><td style="padding:28px">
        <h1 style="font-family:Poppins,Arial,sans-serif;font-size:20px;margin:0 0 16px">${esc(email.subject)}</h1>
        <p style="font-size:15px;line-height:1.6;margin:0">${esc(email.text)}</p>
        ${button}
      </td></tr>
      <tr><td style="padding:16px 28px;background:#eef3f4;font-size:12px;color:#5c5c5d">Tréso Optimum · <a href="${esc(appUrl)}" style="color:#114C5C">${esc(appUrl.replace(/^https?:\/\//, ''))}</a></td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export class SmtpMailer implements Mailer {
  private transport: Transporter;
  constructor(
    private cfg: { host: string; port: number; secure: boolean; user: string; pass: string; from: string },
    private appUrl: string,
  ) {
    this.transport = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
  }
  async send(email: Email): Promise<void> {
    await this.transport.sendMail({
      from: this.cfg.from,
      to: email.to,
      subject: email.subject,
      text: `${email.text}${email.link ? `\n\n${email.link}` : ''}`,
      html: renderEmailHtml(email, this.appUrl),
    });
  }
}
