const crypto = require('crypto')
const https = require('https')
const prisma = require('../lib/prisma')
const { processPaidEnrollment } = require('../services/academyOnboardingService')

const PACKAGES = {
  premium: {
    amountNgn: parseInt(process.env.PREMIUM_PRICE_NGN, 10) || 60000,
    systemIncluded: true,
    upgradeEligible: false,
  },
  basic: {
    amountNgn: parseInt(process.env.BASIC_PRICE_NGN, 10) || 50000,
    systemIncluded: false,
    upgradeEligible: true,
  },
}

function paystackPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const options = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function selectPackage(req, res) {
  try {
    const { leadId, package: pkg } = req.body
    if (!leadId) {
      return res.status(400).json({ success: false, message: 'leadId is required' })
    }
    if (!PACKAGES[pkg]) {
      return res.status(400).json({ success: false, message: 'package must be "premium" or "basic"' })
    }

    const { amountNgn, systemIncluded, upgradeEligible } = PACKAGES[pkg]

    const registration = await prisma.academyRegistration.findUnique({ where: { id: leadId } })
    if (!registration) {
      return res.status(404).json({ success: false, message: 'Registration not found' })
    }

    // Initialize transaction — amount in kobo, leadId embedded in metadata
    // callback_url brings the user back to the success gate after payment
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const callbackUrl = `${frontendUrl}/academy/success?registrationId=${leadId}`

    const paystackRes = await paystackPost('/transaction/initialize', {
      email: registration.email,
      amount: amountNgn * 100,
      metadata: { leadId },
      callback_url: callbackUrl,
    })

    if (!paystackRes.status || !paystackRes.data?.authorization_url) {
      console.error('[select-package] Paystack init failed', paystackRes)
      return res.status(502).json({ success: false, message: 'Failed to create payment link' })
    }

    await prisma.academyRegistration.update({
      where: { id: leadId },
      data: {
        academyPackage: pkg,
        academyAmount: amountNgn,
        systemIncluded,
        upgradeEligible,
        paymentStatus: 'pending',
      },
    })

    return res.json({ success: true, paymentLink: paystackRes.data.authorization_url })
  } catch (err) {
    console.error('[select-package]', err)
    return res.status(500).json({ success: false, message: err.message })
  }
}

async function paystackWebhook(req, res) {
  try {
    const rawBody = req.rawBody
    if (!rawBody) {
      return res.status(400).json({ success: false, message: 'Missing raw body' })
    }
    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(rawBody.toString())
      .digest('hex')
    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).json({ success: false, message: 'Invalid signature' })
    }

    const event = req.body
    if (event.event === 'charge.success') {
      const leadId = event.data?.metadata?.leadId
      if (!leadId) {
        console.error('[paystack-webhook] charge.success received with no metadata.leadId — cannot update DB', {
          reference: event.data?.reference,
          email: event.data?.customer?.email,
          metadata: event.data?.metadata,
        })
        return res.sendStatus(200)
      }

      // Paystack sends amount in kobo — convert to naira
      const amountNgn = (event.data?.amount ?? 0) / 100

      console.log('[Paystack] charge.success received:', leadId, amountNgn)

      // Delegate all post-payment logic to the onboarding service
      await processPaidEnrollment(leadId, amountNgn)
    }

    return res.sendStatus(200)
  } catch (err) {
    console.error('[paystack-webhook]', err)
    return res.sendStatus(500)
  }
}

module.exports = { selectPackage, paystackWebhook }
