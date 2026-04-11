/**
 * Email delivery via SendGrid v3 REST API (native fetch — no extra dependency).
 *
 * Required env vars:
 *   SENDGRID_API_KEY    — SendGrid API key (starts with SG.)
 *   EMAIL_FROM_ADDRESS  — verified sender address (e.g. hello@micahskin.com)
 *   EMAIL_FROM_NAME     — display name shown to recipient (e.g. MICAHSKIN)
 */

const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'hello@micahskin.com'
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'MICAHSKIN'

/**
 * Sends a plain-text + HTML email via SendGrid.
 *
 * @param {{ to: string, subject: string, text: string }} param
 * @returns {Promise<{ success?: boolean, skipped?: boolean, providerResponse?: object, error?: string }>}
 */
async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) {
    console.warn('[EmailService] SENDGRID_API_KEY not configured — skipping email send')
    return { skipped: true }
  }

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM_ADDRESS, name: FROM_NAME },
        subject,
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html', value: wrapHtml(subject, text) },
        ],
      }),
    })

    // SendGrid returns HTTP 202 with an empty body on success
    if (response.status === 202) {
      return { success: true, providerResponse: { status: 202 } }
    }

    const data = await response.json().catch(() => ({}))
    console.error('[EmailService] SendGrid error:', JSON.stringify(data))
    return { success: false, error: JSON.stringify(data) }
  } catch (err) {
    console.error('[EmailService] send failed:', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * Wraps plain text in a minimal branded HTML envelope.
 * Splits on newlines so paragraph spacing is preserved.
 */
function wrapHtml(subject, text) {
  const paragraphs = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => `<p style="margin:0 0 14px 0;line-height:1.6;">${line}</p>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${subject}</title></head>
<body style="font-family:Arial,sans-serif;color:#333333;max-width:600px;margin:auto;padding:32px 24px;">
  <div style="margin-bottom:32px;">
    <strong style="font-size:18px;color:#111;">MICAHSKIN</strong>
  </div>
  ${paragraphs}
  <hr style="margin:40px 0;border:none;border-top:1px solid #eeeeee;">
  <p style="font-size:12px;color:#999999;line-height:1.5;">
    You're receiving this message because you enquired about MICAHSKIN skincare solutions.<br>
    Reply directly to this email if you have any questions.
  </p>
</body>
</html>`
}

module.exports = { sendEmail }
