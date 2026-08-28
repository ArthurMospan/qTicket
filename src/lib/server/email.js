// Server-side transactional email. Single delivery point for every route
// (invitations, notifications, OTP login), with two interchangeable providers:
//
//   RESEND_API_KEY  → Resend (https://resend.com) — потребує власний домен,
//                     *.vercel.app верифікувати неможливо (публічний суфікс).
//   BREVO_API_KEY   → Brevo (https://brevo.com) — працює БЕЗ домену: досить
//                     верифікувати одну адресу відправника (300 листів/день
//                     безкоштовно). EMAIL_FROM має бути саме ця адреса.
//
// Якщо задано обидва ключі, перевага у Resend. Без жодного ключа відправка —
// м'який no-op: фічі мають деградувати, а не падати.

function parseFrom() {
  const raw = process.env.EMAIL_FROM || 'QuickTeam <notifications@quickteam.com>';
  const match = raw.match(/^(.*)<([^>]+)>\s*$/);
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, '') || 'QuickTeam',
      email: match[2].trim(),
    };
  }
  return { name: 'QuickTeam', email: raw.trim() };
}

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY || process.env.BREVO_API_KEY);
}

async function sendViaResend({ to, subject, html }) {
  const from = parseFrom();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${from.name} <${from.email}>`,
      to: [to],
      subject,
      html,
    }),
  });
  if (!response.ok) {
    console.error('[email][resend] provider rejected request', await response.text());
    return false;
  }
  return true;
}

async function sendViaBrevo({ to, subject, html }) {
  const from = parseFrom();
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: from.name, email: from.email },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!response.ok) {
    console.error('[email][brevo] provider rejected request', await response.text());
    return false;
  }
  return true;
}

export async function deliverEmail({ to, subject, html }) {
  if (!to) return false;
  if (process.env.RESEND_API_KEY) return sendViaResend({ to, subject, html });
  if (process.env.BREVO_API_KEY) return sendViaBrevo({ to, subject, html });
  return false;
}

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

// The invitation email. `ctaPath` must be an app-relative path ('/login', …)
// so the link can never point outside our own domain.
//
// It is signed by the tenant, not by qTicket. This letter reaches a client who
// has never bought anything from us: they know the company that supports them,
// and «запрошує вас приєднатися… у qTicket», «автоматичне повідомлення від
// qTicket» named the software instead — in the one message where the sender's
// identity is the whole reason the reader trusts the link. No provider is
// connected today, so this is correctness for when one is.
export function invitationEmailHtml({ orgName, inviterName, role, ctaPath }) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const safePath = typeof ctaPath === 'string' && ctaPath.startsWith('/') ? ctaPath : '/login';
  const roleLabel = role === 'admin'
    ? 'адміністратора'
    : role === 'client_admin'
      ? 'адміністратора клієнта'
      : role === 'client_member'
        ? 'представника клієнта'
        : 'спеціаліста';
  // «Підтримка» is the same last-resort name `resolveOrganizationPortalBrand`
  // falls back to, so a nameless organization reads the same in the letter as
  // it does on the portal.
  const org = escapeHtml(orgName || 'Підтримка');
  const inviter = escapeHtml(inviterName || 'Колега');
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f1f1f;line-height:1.6;margin:0;padding:0">
      <div style="max-width:600px;margin:0 auto;padding:24px 20px">
        <h2 style="margin:0 0 12px">Вас запрошено до «${org}»</h2>
        <p style="margin:0 0 16px"><strong>${inviter}</strong> запрошує вас до порталу підтримки <strong>${org}</strong> у ролі ${roleLabel}.</p>
        <p style="margin:0 0 24px">Увійдіть з цією адресою пошти — і ви одразу потрапите в команду.</p>
        <p style="margin:0 0 24px"><a href="${baseUrl}${safePath}" style="display:inline-block;padding:12px 24px;background:#1f1f1f;color:#ffffff;border-radius:8px;text-decoration:none">Приєднатися</a></p>
        <hr style="border:none;border-top:1px solid #e9e9e9;margin:24px 0">
        <p style="font-size:12px;color:#9a9a9a;margin:0">Це автоматичне повідомлення порталу підтримки «${org}». Якщо ви не очікували цього запрошення — просто проігноруйте лист.</p>
      </div>
    </body>
    </html>
  `;
}
