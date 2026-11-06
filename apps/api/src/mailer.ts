/**
 * Envoi des emails transactionnels. En développement et en test, les emails
 * sont journalisés et conservés en mémoire ; en production, brancher un
 * fournisseur (Brevo, Postmark) en implémentant `Mailer`.
 */
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
