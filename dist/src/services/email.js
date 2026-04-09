import { Resend } from 'resend';
import { config } from '../config.js';
// ─────────────────────────────────────────────────────────────────────────────
// Resend client (lazy-initialised so the server starts even without the key)
// ─────────────────────────────────────────────────────────────────────────────
let _resend = null;
function getResend() {
    if (!_resend)
        _resend = new Resend(config.resendApiKey);
    return _resend;
}
// ─────────────────────────────────────────────────────────────────────────────
// Shared brand styles (inline — email clients strip <style> blocks)
// ─────────────────────────────────────────────────────────────────────────────
const STYLES = {
    body: 'margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;',
    wrapper: 'max-width:600px;margin:0 auto;padding:48px 24px;',
    header: 'margin-bottom:40px;',
    logo: 'font-size:22px;font-weight:700;color:#e8a020;letter-spacing:0.05em;text-decoration:none;',
    h1: 'font-size:28px;font-weight:700;color:#ffffff;margin:0 0 8px;line-height:1.3;',
    subtitle: 'font-size:16px;color:#8a8a9a;margin:0 0 40px;',
    card: 'background:#14141e;border:1px solid #1e1e2e;border-radius:12px;padding:28px;margin-bottom:24px;',
    label: 'font-size:11px;font-weight:600;color:#e8a020;letter-spacing:0.1em;text-transform:uppercase;margin:0 0 8px;',
    value: 'font-size:15px;color:#ffffff;margin:0;word-break:break-all;',
    bodyText: 'font-size:15px;color:#c0c0d0;line-height:1.6;margin:0 0 16px;',
    link: 'color:#e8a020;text-decoration:none;',
    divider: 'border:none;border-top:1px solid #1e1e2e;margin:32px 0;',
    footer: 'font-size:13px;color:#4a4a5a;line-height:1.6;margin:0;',
    ctaButton: 'display:inline-block;background:#e8a020;color:#0a0a0f;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;letter-spacing:0.02em;',
};
// ─────────────────────────────────────────────────────────────────────────────
// Welcome email — sent once on first login
// ─────────────────────────────────────────────────────────────────────────────
export async function sendWelcomeEmail(email, displayName, lightId) {
    const resend = getResend();
    const polygonscanUrl = `https://polygonscan.com/address/${lightId}`;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Welcome to Hekkova</title>
</head>
<body style="${STYLES.body}">
  <div style="${STYLES.wrapper}">

    <div style="${STYLES.header}">
      <span style="${STYLES.logo}">HEKKOVA</span>
    </div>

    <h1 style="${STYLES.h1}">Welcome, ${escapeHtml(displayName)}.</h1>
    <p style="${STYLES.subtitle}">Your moments now have a permanent home.</p>

    <div style="${STYLES.card}">
      <p style="${STYLES.label}">Your Light ID</p>
      <p style="${STYLES.value}">${escapeHtml(lightId)}</p>
    </div>

    <p style="${STYLES.bodyText}">
      Your Light ID is your permanent identity on the blockchain. It's how you can independently verify
      that your moments belong to you — no Hekkova needed.
    </p>

    <p style="${STYLES.bodyText}">
      <a href="${polygonscanUrl}" style="${STYLES.link}">View your identity on Polygon &rarr;</a>
    </p>

    <p style="font-size:14px;font-weight:600;color:#e8a020;margin:24px 0;">
      Save this email. Your Light ID is your proof of ownership.
    </p>

    <hr style="${STYLES.divider}" />

    <p style="${STYLES.bodyText}">
      You're all set. Start capturing moments that matter.
    </p>

    <a href="https://app.hekkova.com" style="${STYLES.ctaButton}">Visit your dashboard</a>

    <hr style="${STYLES.divider}" />

    <p style="${STYLES.footer}">
      Your moments, illuminated forever.<br />
      <a href="https://hekkova.com" style="color:#4a4a5a;">hekkova.com</a>
    </p>

  </div>
</body>
</html>`;
    const { error } = await resend.emails.send({
        from: 'Hekkova <no-reply@hekkova.com>',
        to: email,
        subject: 'Welcome to Hekkova — Your Light ID',
        html,
    });
    if (error) {
        throw new Error(`Resend error (welcome): ${error.message}`);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Mint notification email — sent per successful mint (opt-in only)
// ─────────────────────────────────────────────────────────────────────────────
export async function sendMintEmail(email, displayName, momentTitle, blockId, tokenId, category) {
    const resend = getResend();
    const polygonscanUrl = `https://polygonscan.com/tx/${blockId}`;
    const categoryLabel = category
        ? category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : null;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Moment Preserved</title>
</head>
<body style="${STYLES.body}">
  <div style="${STYLES.wrapper}">

    <div style="${STYLES.header}">
      <span style="${STYLES.logo}">HEKKOVA</span>
    </div>

    <h1 style="${STYLES.h1}">A new moment has been added to your Arc.</h1>
    <p style="${STYLES.subtitle}">It's permanent now, ${escapeHtml(displayName)}.</p>

    <div style="${STYLES.card}">
      <p style="${STYLES.label}">Moment</p>
      <p style="${STYLES.value}">${escapeHtml(momentTitle)}</p>
      ${categoryLabel ? `<p style="font-size:13px;color:#8a8a9a;margin:6px 0 0;">${escapeHtml(categoryLabel)}</p>` : ''}
    </div>

    <div style="${STYLES.card}">
      <p style="${STYLES.label}">Block ID</p>
      <p style="${STYLES.value}">
        <a href="${polygonscanUrl}" style="${STYLES.link}">${escapeHtml(blockId)}</a>
      </p>
    </div>

    <div style="${STYLES.card}">
      <p style="${STYLES.label}">Token ID</p>
      <p style="${STYLES.value}">#${tokenId}</p>
    </div>

    <hr style="${STYLES.divider}" />

    <a href="https://app.hekkova.com/dashboard/arc" style="${STYLES.ctaButton}">View in your Arc</a>

    <hr style="${STYLES.divider}" />

    <p style="${STYLES.footer}">
      Your moments, illuminated forever.<br />
      <a href="https://hekkova.com" style="color:#4a4a5a;">hekkova.com</a>
      &nbsp;&middot;&nbsp;
      <a href="https://app.hekkova.com/dashboard/settings" style="color:#4a4a5a;">Manage email preferences</a>
    </p>

  </div>
</body>
</html>`;
    const { error } = await resend.emails.send({
        from: 'Hekkova <no-reply@hekkova.com>',
        to: email,
        subject: `Moment Preserved — ${momentTitle}`,
        html,
    });
    if (error) {
        throw new Error(`Resend error (mint): ${error.message}`);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
//# sourceMappingURL=email.js.map