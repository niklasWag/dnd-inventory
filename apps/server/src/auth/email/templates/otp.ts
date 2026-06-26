/**
 * R3.3 — Email OTP template.
 *
 * Renders the one-time-code email body. Plaintext-first per SECURITY §1.2 +
 * the project's "no tracking pixels, no logos, no marketing" stance — the
 * email's only job is to deliver a code. The HTML variant exists for
 * clients that strip the plaintext alternative; both contain the same
 * digits.
 *
 * The OTP appears in plain text (not in a CSS-hidden field, not as an
 * image, not in a hyperlink). Corporate email gateways that mangle
 * markup-heavy mail still deliver the code intact.
 */

export interface RenderedOtpEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Render the OTP email body. `code` MUST be the 8-digit zero-padded string
 * from `generateOtp()`; the caller is responsible for that — this renderer
 * does no validation.
 */
export function renderOtpEmail(code: string): RenderedOtpEmail {
  const subject = 'Your D&D Inventory sign-in code';

  const text = [
    `Your sign-in code is: ${code}`,
    '',
    'Enter this code on the sign-in page within 15 minutes to log in.',
    '',
    'If you did not request this code, you can safely ignore this email — no one can sign in without it.',
  ].join('\n');

  // Minimal HTML — same content, slightly nicer rendering. No external
  // resources, no styled buttons, no tracking. The code is in a <strong>
  // so it stands out in an inbox preview but the surrounding plain text
  // means the email is still readable if the HTML is stripped.
  const html = [
    '<!doctype html>',
    '<html><body style="font-family: system-ui, sans-serif; line-height: 1.5;">',
    `<p>Your sign-in code is: <strong style="font-size: 1.4em; letter-spacing: 0.1em;">${code}</strong></p>`,
    '<p>Enter this code on the sign-in page within 15 minutes to log in.</p>',
    '<p style="color: #555; font-size: 0.9em;">If you did not request this code, you can safely ignore this email — no one can sign in without it.</p>',
    '</body></html>',
  ].join('\n');

  return { subject, text, html };
}
