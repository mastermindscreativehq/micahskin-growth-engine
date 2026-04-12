const crypto = require('crypto')
const prisma = require('../lib/prisma')

const PACKAGES = {
  premium: {
    amount: 60000,
    systemIncluded: true,
    upgradeEligible: false,
    paymentLink: 'https://paystack.shop/pay/micahskinpremium',
  },
  basic: {
    amount: 50000,
    systemIncluded: false,
    upgradeEligible: true,
    paymentLink: 'https://paystack.shop/pay/micahskinbasic',
  },
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
    const { amount, systemIncluded, upgradeEligible, paymentLink } = PACKAGES[pkg]
    await prisma.academyRegistration.update({
      where: { id: leadId },
      data: {
        academyPackage: pkg,
        academyAmount: amount,
        systemIncluded,
        upgradeEligible,
        paymentStatus: 'pending',
      },
    })
    return res.json({ success: true, paymentLink })
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
      const registrationId = event.data?.metadata?.registrationId
      const email = event.data?.customer?.email
      if (registrationId) {
        await prisma.academyRegistration.update({
          where: { id: registrationId },
          data: { paymentStatus: 'paid', academyStatus: 'enrolled' },
        })
      } else if (email) {
        const reg = await prisma.academyRegistration.findFirst({
          where: { email, paymentStatus: 'pending' },
          orderBy: { createdAt: 'desc' },
        })
        if (reg) {
          await prisma.academyRegistration.update({
            where: { id: reg.id },
            data: { paymentStatus: 'paid', academyStatus: 'enrolled' },
          })
        }
      }
    }
    return res.sendStatus(200)
  } catch (err) {
    console.error('[paystack-webhook]', err)
    return res.sendStatus(500)
  }
}

module.exports = { selectPackage, paystackWebhook }
