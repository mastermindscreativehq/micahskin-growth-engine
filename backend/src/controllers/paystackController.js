'use strict'

const crypto = require('crypto')
const https  = require('https')
const prisma = require('../lib/prisma')
const { processPaidEnrollment } = require('../services/academyOnboardingService')
const { sendTelegramToUser }    = require('../services/telegramService')

const LEAD_BOT_TOKEN = process.env.TELEGRAM_LEAD_BOT_TOKEN
const ADMIN_CHAT_ID  = process.env.TELEGRAM_ADMIN_CHAT_ID

const PACKAGES = {
  premium: {
    amountNgn:       parseInt(process.env.PREMIUM_PRICE_NGN, 10) || 60000,
    systemIncluded:  true,
    upgradeEligible: false,
  },
  basic: {
    amountNgn:       parseInt(process.env.BASIC_PRICE_NGN, 10) || 50000,
    systemIncluded:  false,
    upgradeEligible: true,
  },
}

// ── Paystack helpers ──────────────────────────────────────────────────────────

function paystackPost(path, body) {
  return new Promise((resolve, reject) => {
    const data    = JSON.stringify(body)
    const options = {
      hostname: 'api.paystack.co',
      port:     443,
      path,
      method:   'POST',
      headers:  {
        Authorization:    `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function paystackGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.paystack.co',
      port:     443,
      path,
      method:   'GET',
      headers:  {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    }
    const req = https.request(options, (res) => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// ── Academy package selection ─────────────────────────────────────────────────

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

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const callbackUrl = `${frontendUrl}/academy/success?registrationId=${leadId}`

    const paystackRes = await paystackPost('/transaction/initialize', {
      email:        registration.email,
      amount:       amountNgn * 100,
      metadata:     { leadId },
      callback_url: callbackUrl,
    })

    if (!paystackRes.status || !paystackRes.data?.authorization_url) {
      console.error('[select-package] Paystack init failed', paystackRes)
      return res.status(502).json({ success: false, message: 'Failed to create payment link' })
    }

    await prisma.academyRegistration.update({
      where: { id: leadId },
      data:  {
        academyPackage:  pkg,
        academyAmount:   amountNgn,
        systemIncluded,
        upgradeEligible,
        paymentStatus:   'pending',
      },
    })

    return res.json({ success: true, paymentLink: paystackRes.data.authorization_url })
  } catch (err) {
    console.error('[select-package]', err)
    return res.status(500).json({ success: false, message: err.message })
  }
}

// ── Product quote payment handler ─────────────────────────────────────────────

async function handleProductQuotePayment(event) {
  const { reference, amount, channel, customer, metadata, paid_at } = event.data
  const { leadId, quoteId } = metadata || {}

  console.log(`[PaystackWebhook] received | ref=${reference} type=product_quote leadId=${leadId} quoteId=${quoteId}`)

  if (!leadId || !quoteId) {
    console.error('[PaystackWebhook] product_quote missing leadId or quoteId in metadata', metadata)
    return
  }

  // Idempotency — skip if already processed
  const existing = await prisma.paymentTransaction.findUnique({
    where: { paystackReference: reference },
  })
  if (existing) {
    console.log(`[PaystackWebhook] already_processed | ref=${reference}`)
    return
  }

  // Verify transaction with Paystack API
  const verify = await paystackGet(`/transaction/verify/${encodeURIComponent(reference)}`)
  if (!verify.status || verify.data?.status !== 'success') {
    console.error(`[PaystackWebhook] verification failed | ref=${reference} paystackStatus=${verify.data?.status}`)
    return
  }

  console.log(`[PaystackWebhook] verified | ref=${reference}`)

  const amountNgn = amount / 100

  // Fetch lead and quote
  const [lead, quote] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.productQuote.findUnique({ where: { id: quoteId }, include: { items: true } }),
  ])

  if (!lead) {
    console.error(`[PaystackWebhook] lead not found | leadId=${leadId}`)
    return
  }
  if (!quote) {
    console.error(`[PaystackWebhook] quote not found | quoteId=${quoteId}`)
    return
  }

  if (Math.abs(amountNgn - quote.totalAmount) > 1) {
    console.warn(`[PaystackWebhook] amount mismatch | paid=₦${amountNgn} expected=₦${quote.totalAmount} — proceeding`)
  }

  const paidAt = paid_at ? new Date(paid_at) : new Date()

  // Atomic DB update
  await prisma.$transaction(async (tx) => {
    const paymentTx = await tx.paymentTransaction.create({
      data: {
        leadId,
        quoteId,
        paystackReference: reference,
        amount:     amountNgn,
        currency:   'NGN',
        status:     'success',
        channel:    channel || null,
        paidAt,
        rawPayload: event.data,
      },
    })

    await tx.productQuote.update({
      where: { id: quoteId },
      data:  {
        paymentStatus:    'paid',
        paidAt,
        paymentReference: reference,
        fulfillmentStatus: 'pending_fulfillment',
      },
    })

    await tx.lead.update({
      where: { id: leadId },
      data:  {
        quoteStatus:       'paid',
        paymentStatus:     'paid',
        paidAt,
        lastPaidAmount:    amountNgn,
        conversionStage:   'paid',
        conversionPath:    'product_quote_paid',
        conversionAt:      paidAt,
        conversionType:    'product_quote',
        conversionValue:   amountNgn,
        leadStage:         'converted',
        lastInteractionAt: paidAt,
      },
    })

    const hasAddress = !!(lead.deliveryAddress || lead.phone)
    const fulfillmentStatus = hasAddress ? 'pending_packing' : 'awaiting_address'

    const order = await tx.fulfillmentOrder.create({
      data: {
        leadId,
        quoteId,
        paymentTransactionId: paymentTx.id,
        status:         fulfillmentStatus,
        totalAmount:    amountNgn,
        customerName:   lead.fullName || customer?.first_name || 'Unknown',
        customerEmail:  lead.email    || customer?.email      || null,
        customerPhone:  lead.phone    || null,
        deliveryAddress: lead.deliveryAddress || null,
        notes:          `Paystack ref: ${reference}`,
      },
    })

    // Flag lead to collect delivery address via Telegram if we don't have it
    if (!hasAddress && lead.telegramChatId) {
      await tx.lead.update({
        where: { id: leadId },
        data: { telegramStage: 'awaiting_delivery_address' },
      })
    }

    console.log(`[PaystackWebhook] paid quote=${quoteId} txId=${paymentTx.id}`)
    console.log(`[Fulfillment] created order=${order.id} status=${fulfillmentStatus}`)
    if (fulfillmentStatus === 'awaiting_address') {
      console.log(`[Fulfillment] awaiting address | leadId=${leadId}`)
    }
  })

  await prisma.messageLog.create({
    data: {
      type:          'lead',
      recordId:      leadId,
      channel:       'paystack',
      status:        'paid',
      auto:          true,
      triggerReason: 'product_quote_payment',
      recipient:     lead.email || String(lead.telegramChatId || ''),
    },
  }).catch(e => console.error('[PaystackWebhook] MessageLog write failed:', e.message))

  // Admin Telegram alert
  if (ADMIN_CHAT_ID && LEAD_BOT_TOKEN) {
    const adminMsg = [
      '💰 <b>Payment received</b>',
      '',
      `Lead: ${lead.fullName}`,
      `Phone: ${lead.phone || '—'}`,
      `Email: ${lead.email || '—'}`,
      `Amount: ₦${amountNgn.toLocaleString('en-NG')}`,
      `Quote ID: ...${quoteId.slice(-8)}`,
      `Ref: ${reference}`,
      'Fulfillment: pending',
    ].join('\n')

    await sendTelegramToUser(ADMIN_CHAT_ID, adminMsg, LEAD_BOT_TOKEN)
      .catch(e => console.error('[Telegram] admin alert failed:', e.message))
    console.log('[Telegram] payment confirmation sent (admin)')
  }

  // Lead confirmation via Telegram
  if (lead.telegramChatId) {
    const hasAddress = !!(lead.deliveryAddress || lead.phone)

    let leadMsg
    if (hasAddress) {
      leadMsg = [
        'Payment confirmed ✅',
        '',
        "We've received your payment for your skincare package.",
        'Our team is preparing your order now.',
        '',
        'We will reach out shortly once your order is ready.',
        '',
        'Thank you for trusting MICAHSKIN! 🌿',
      ].join('\n')
    } else {
      leadMsg = [
        'Payment confirmed ✅',
        '',
        "We've received your payment for your skincare package.",
        '',
        'To complete your order, please send us your delivery details:',
        '',
        '1. Full name',
        '2. Phone number',
        '3. Delivery address',
        '4. City / State',
        '5. Any delivery notes (or reply NONE)',
        '',
        'Please send all details in one message so we can process your order quickly 🌿',
      ].join('\n')
    }

    await sendTelegramToUser(lead.telegramChatId, leadMsg, LEAD_BOT_TOKEN)
      .catch(e => console.error('[Telegram] lead confirmation failed:', e.message))
    console.log(`[Telegram] payment confirmation sent | leadId=${leadId} awaitingAddress=${!hasAddress}`)
  }
}

// ── Webhook handler ───────────────────────────────────────────────────────────

async function paystackWebhook(req, res) {
  try {
    console.log('[PaystackWebhook] received')

    const rawBody = req.rawBody
    if (!rawBody) {
      return res.status(400).json({ success: false, message: 'Missing raw body' })
    }

    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
      .update(rawBody.toString())
      .digest('hex')

    if (hash !== req.headers['x-paystack-signature']) {
      console.warn('[PaystackWebhook] invalid signature')
      return res.status(401).json({ success: false, message: 'Invalid signature' })
    }

    const event    = req.body
    const metadata = event.data?.metadata || {}
    const type     = metadata.type

    if (event.event !== 'charge.success') {
      console.log(`[PaystackWebhook] ignored event=${event.event}`)
      return res.sendStatus(200)
    }

    if (type === 'product_quote') {
      await handleProductQuotePayment(event)
    } else {
      // Academy payment — leadId here is AcademyRegistration.id
      const leadId = metadata.leadId
      if (!leadId) {
        console.error('[PaystackWebhook] charge.success with no metadata.leadId', {
          reference: event.data?.reference,
          email:     event.data?.customer?.email,
          metadata,
        })
        return res.sendStatus(200)
      }

      const amountNgn = (event.data?.amount ?? 0) / 100
      console.log('[Paystack] academy charge.success | leadId:', leadId, 'amount:', amountNgn)
      await processPaidEnrollment(leadId, amountNgn)
    }

    return res.sendStatus(200)
  } catch (err) {
    console.error('[paystack-webhook]', err)
    return res.sendStatus(500)
  }
}

module.exports = { selectPackage, paystackWebhook }
