/**
 * Generate email HTML template
 */
export function generateEmailTemplate({
  type,
  title,
  body,
  issueKey,
  link,
  projectName,
  userName,
}) {
  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  title = escapeHtml(title);
  body = escapeHtml(body).replaceAll('\n', '<br>');
  issueKey = escapeHtml(issueKey);
  projectName = escapeHtml(projectName);
  userName = escapeHtml(userName);
  link = typeof link === 'string' && link.startsWith('/') ? link : '/';
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const fullLink = baseUrl + link;

  const templates = {
    commented: `
      <h2>${title}</h2>
      <p><strong>${userName}</strong> написав коментар до завданьи <code>${issueKey}</code>:</p>
      <blockquote style="border-left: 4px solid #e9e9e9; padding-left: 16px; margin: 16px 0; color: #666;">
        ${body}
      </blockquote>
      <p><a href="${fullLink}" style="display: inline-block; padding: 12px 24px; background: #1f1f1f; color: white; border-radius: 8px; text-decoration: none;">Переглянути завдання</a></p>
    `,
    assigned: `
      <h2>${title}</h2>
      <p>Вам призначена завдання <code>${issueKey}</code> в проекті <strong>${projectName}</strong>.</p>
      <p>${body}</p>
      <p><a href="${fullLink}" style="display: inline-block; padding: 12px 24px; background: #1f1f1f; color: white; border-radius: 8px; text-decoration: none;">Переглянути завдання</a></p>
    `,
    blocked: `
      <h2>${title}</h2>
      <p>Завдання <code>${issueKey}</code> заблокована іншою завданням.</p>
      <p>${body}</p>
      <p><a href="${fullLink}" style="display: inline-block; padding: 12px 24px; background: #dc2626; color: white; border-radius: 8px; text-decoration: none;">Переглянути деталі</a></p>
    `,
    default: `
      <h2>${title}</h2>
      <p>${body}</p>
      <p><a href="${fullLink}" style="display: inline-block; padding: 12px 24px; background: #1f1f1f; color: white; border-radius: 8px; text-decoration: none;">Переглянути</a></p>
    `,
  };

  const template = templates[type] || templates.default;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1f1f1f; line-height: 1.6; }
        a { color: #1f1f1f; text-decoration: none; }
        code { background: #f4f4f5; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
      </style>
    </head>
    <body>
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        ${template}
        <hr style="border: none; border-top: 1px solid #e9e9e9; margin: 30px 0;">
        <p style="font-size: 12px; color: #9a9a9a;">
          Це автоматичне повідомлення від QuickTeam.
          <a href="${baseUrl}/settings">Керування сповіщеннями</a>
        </p>
      </div>
    </body>
    </html>
  `;
}
