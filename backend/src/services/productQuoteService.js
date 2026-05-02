'use strict'

const https  = require('https')
const crypto = require('crypto')
const prisma = require('../lib/prisma')
const { matchProductsForLeadId } = require('./productMatchService')
const { sendTelegramToUser, sendTelegramMessage } = require('./telegramService')

const LEAD_BOT_TOKEN = process.env.TELEGRAM_LEAD_BOT_TOKEN
const WHATSAPP_LINK  = process.env.WHATSAPP_LINK || 'https://wa.me/+2348140468759'

// ── Paystack helper ────────────────────────────────────────────────────────────

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

// ── Generate Paystack payment link for a quote ────────────────────────────────

/**
 * Initialises a fresh Paystack transaction for the quote.
 * Always generates a unique reference — never reuses an old authorization_url.
 * Saves the reference and checkout URL back to the ProductQuote row.
 * Returns the authorization_url or null on failure.
 */
async function generatePaymentLink(lead, quote) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    console.warn('[QuoteService] PAYSTACK_SECRET_KEY not set — skipping payment link')
    return null
  }
  if (!lead.email) {
    console.warn(`[QuoteService] Lead ${lead.id} has no email — skipping Paystack link`)
    return null
  }
  if (!quote.totalAmount || quote.totalAmount <= 0) {
    console.warn(`[QuoteService] Quote ${quote.id} total is 0 — skipping Paystack link`)
    return null
  }

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  const callbackUrl = `${frontendUrl}/?productQuote=${quote.id}`
  // Always generate a unique reference so old auth URLs are never reused
  const reference = `msk_${quote.id.slice(-8)}_${crypto.randomBytes(4).toString('hex')}`
  const amountKobo = Math.round(quote.totalAmount * 100)

  console.log(`[QuoteService] Paystack init | quoteId=${quote.id} leadId=${lead.id} amount=₦${quote.totalAmount} (${amountKobo} kobo) reference=${reference}`)

  try {
    const res = await paystackPost('/transaction/initialize', {
      email:        lead.email,
      amount:       amountKobo,
      reference,
      metadata: {
        leadId:   lead.id,
        quoteId:  quote.id,
        type:     'product_quote',
        fullName: lead.fullName,
      },
      callback_url: callbackUrl,
    })

    console.log(`[QuoteService] Paystack response | quoteId=${quote.id} status=${res.status} message=${res.message || 'n/a'}`)

    if (res.status && res.data?.authorization_url) {
      const authUrl = res.data.authorization_url
      const ref     = res.data.reference || reference

      // Persist reference + checkout URL so admin can inspect and we never reuse stale links
      await prisma.productQuote.update({
        where: { id: quote.id },
        data:  { paymentReference: ref, checkoutUrl: authUrl },
      }).catch(e => console.error(`[QuoteService] failed to save checkout URL | quoteId=${quote.id}:`, e.message))

      console.log(`[QuoteService] Paystack link generated | quoteId=${quote.id} reference=${ref} url=${authUrl}`)
      return authUrl
    }

    console.error(`[QuoteService] Paystack init failed | quoteId=${quote.id} response=${JSON.stringify(res)}`)
    return null
  } catch (err) {
    console.error(`[QuoteService] Paystack error | quoteId=${quote.id}:`, err.message)
    return null
  }
}

// ── Build the unified Telegram message ────────────────────────────────────────

function buildDiagnosisAndQuoteMessage(lead, quote, paymentLink) {
  const firstName = (lead.fullName || 'there').split(' ')[0]

  const diag    = (typeof lead.diagnosis === 'object' && lead.diagnosis) ? lead.diagnosis : {}
  const routine = (typeof lead.routine   === 'object' && lead.routine)   ? lead.routine   : {}

  const assessment = diag.text || null
  const notes      = Array.isArray(diag.notes)      ? diag.notes      : []
  const morning    = Array.isArray(routine.morning) ? routine.morning : []
  const night      = Array.isArray(routine.night)   ? routine.night   : []

  const lines = []

  lines.push(`Hi ${firstName} 🌿`)
  lines.push('')
  lines.push("Here's your personalised skincare plan and product quote:")

  if (assessment) {
    lines.push('')
    lines.push('<b>Skin Assessment:</b>')
    lines.push(assessment)
  }

  if (morning.length > 0) {
    lines.push('')
    lines.push('<b>Morning Routine:</b>')
    morning.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
  }

  if (night.length > 0) {
    lines.push('')
    lines.push('<b>Night Routine:</b>')
    night.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
  }

  if (notes.length > 0) {
    lines.push('')
    lines.push('<b>Important Notes:</b>')
    notes.forEach(n => lines.push(`• ${n}`))
  }

  if (quote.items && quote.items.length > 0) {
    lines.push('')
    lines.push('<b>Your Product List:</b>')
    for (const item of quote.items) {
      const price = item.editedPrice != null ? item.editedPrice : item.unitPrice
      const step  = item.routineStep ? ` (${item.routineStep})` : ''
      const qty   = item.quantity > 1 ? ` × ${item.quantity}` : ''
      const priceStr = price > 0 ? ` — ₦${price.toLocaleString('en-NG')}` : ''
      lines.push(`• ${item.productName}${step}${qty}${priceStr}`)
    }

    lines.push('')
    lines.push(`<b>Total: ₦${quote.totalAmount.toLocaleString('en-NG')}</b>`)
  }

  if (paymentLink) {
    lines.push('')
    lines.push('Ready to get started? Pay securely here:')
    lines.push(`👉 ${paymentLink}`)
  } else {
    lines.push('')
    lines.push('To place your order, message us directly:')
    lines.push(`👉 ${WHATSAPP_LINK}`)
  }

  lines.push('')
  lines.push('Reply:')
  lines.push('- <b>PRODUCT</b> for product questions')
  lines.push('- <b>CONSULT</b> for private consultation')
  lines.push('- <b>ACADEMY</b> to learn about the academy')

  return lines.join('\n')
}

// ── Core functions ─────────────────────────────────────────────────────────────

async function generateQuoteForLead(leadId, matchResult) {
  const match = matchResult || await matchProductsForLeadId(leadId)
  if (!match) throw new Error(`Lead ${leadId} not found`)

  const allProducts = [...match.morning, ...match.night, ...match.addons]
  const seen  = new Set()
  const items = []

  for (const p of allProducts) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    const unitPrice = p.price || 0
    items.push({
      productId:   p.id,
      productName: p.productName,
      routineStep: p.category,
      quantity:    1,
      unitPrice,
      editedPrice: null,
      subtotal:    unitPrice,
      notes:       p.description ? p.description.slice(0, 100) : null,
    })
  }

  const totalAmount = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)

  const quote = await prisma.productQuote.create({
    data: {
      leadId,
      status:      'pending_review',
      totalAmount,
      currency:    'NGN',
      items: { create: items },
    },
    include: { items: true },
  })

  await prisma.lead.update({
    where: { id: leadId },
    data:  { quoteStatus: 'pending_review' },
  })

  console.log(`[ProductQuote] draft_created awaiting_admin_review | quoteId=${quote.id} leadId=${leadId} items=${items.length} total=₦${totalAmount}`)
  return quote
}

async function recomputeQuoteTotal(quoteId) {
  const items = await prisma.productQuoteItem.findMany({ where: { quoteId } })
  const totalAmount = items.reduce((sum, i) => {
    const price = i.editedPrice != null ? i.editedPrice : i.unitPrice
    return sum + price * i.quantity
  }, 0)
  return prisma.productQuote.update({
    where: { id: quoteId },
    data:  { totalAmount, updatedAt: new Date() },
  })
}

async function updateQuoteItem(quoteId, itemId, fields) {
  // Fetch existing item before update so we can sync catalog price if editedPrice changed
  const existing = await prisma.productQuoteItem.findUnique({ where: { id: itemId } })

  const updated = await prisma.productQuoteItem.update({
    where: { id: itemId },
    data: {
      ...(fields.editedPrice != null ? { editedPrice: Number(fields.editedPrice) } : {}),
      ...(fields.quantity    != null ? { quantity:    Number(fields.quantity) }     : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes }                      : {}),
    },
  })

  const effectivePrice = updated.editedPrice != null ? updated.editedPrice : updated.unitPrice
  await prisma.productQuoteItem.update({
    where: { id: itemId },
    data:  { subtotal: effectivePrice * updated.quantity },
  })

  await recomputeQuoteTotal(quoteId)

  // If admin changed the price, sync back to the catalog product
  if (fields.editedPrice != null && updated.productId) {
    const newPrice = Number(fields.editedPrice)
    const oldPrice = existing?.unitPrice ?? null
    await prisma.skincareProduct.update({
      where: { id: updated.productId },
      data:  { price: newPrice },
    }).catch(e => console.error(`[ProductQuote] catalog price sync failed | productId=${updated.productId}:`, e.message))
    console.log(`[ProductQuote] catalog_price_updated productId=${updated.productId} old=${oldPrice} new=${newPrice}`)
  }

  console.log(`[ProductQuote] item_updated | quoteId=${quoteId} itemId=${itemId}`)
  return { ...updated, _catalogPriceUpdated: !!(fields.editedPrice != null && updated.productId) }
}

async function approveQuote(quoteId, reviewedBy) {
  const quote = await prisma.productQuote.update({
    where: { id: quoteId },
    data: {
      status:     'approved',
      reviewedBy: reviewedBy || 'admin',
      reviewedAt: new Date(),
    },
    include: { items: true },
  })

  await prisma.lead.update({
    where: { id: quote.leadId },
    data:  { quoteStatus: 'approved' },
  })

  console.log(`[QuoteService] Quote approved | quoteId=${quoteId} by=${reviewedBy}`)
  return quote
}

async function markQuoteSent(quoteId) {
  const quote = await prisma.productQuote.update({
    where: { id: quoteId },
    data:  { status: 'sent', sentAt: new Date() },
    include: { items: true },
  })

  await prisma.lead.update({
    where: { id: quote.leadId },
    data:  { quoteStatus: 'sent', productQuoteSentAt: new Date() },
  })

  return quote
}

async function getQuotesForLead(leadId) {
  return prisma.productQuote.findMany({
    where:   { leadId },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  })
}

async function getLatestActiveQuote(leadId) {
  return prisma.productQuote.findFirst({
    where:   { leadId, status: { not: 'cancelled' } },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Send unified Diagnosis + Quote message to lead via Telegram.
 * Generates a Paystack payment link if lead has email and quote total > 0.
 * Marks the quote as sent and updates Lead record.
 */
async function sendDiagnosisAndQuote(leadId, quoteId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) throw new Error(`Lead ${leadId} not found`)

  // Warn if already sent but do NOT block — admin may need to resend with a fresh Paystack link
  if (lead.productQuoteSentAt) {
    console.warn(`[QuoteService] re-send requested | leadId=${leadId} previousSentAt=${lead.productQuoteSentAt.toISOString()} — generating fresh Paystack link`)
  }

  if (!lead.telegramChatId) {
    throw new Error('Lead has no Telegram connection — cannot send quote')
  }

  const quote = quoteId
    ? await prisma.productQuote.findUnique({ where: { id: quoteId }, include: { items: true } })
    : await getLatestActiveQuote(leadId)

  if (!quote) throw new Error('No active quote found for this lead')
  // Allow resend even if previously sent — fresh Paystack link will be generated below
  if (quote.status === 'sent') {
    console.warn(`[QuoteService] quote status=sent but resend requested | quoteId=${quote.id} leadId=${leadId}`)
  }

  // Hard guard — quote must be approved by admin before it can be sent.
  // This prevents any automated path from sending prices that haven't been reviewed.
  if (quote.status === 'pending_review') {
    console.log(`[ProductQuote] blocked_auto_send_requires_admin_review | leadId=${leadId} quoteId=${quote.id}`)
    throw new Error('Quote must be approved by admin before sending — please review prices in CRM first')
  }

  // Refresh total from items before sending
  await recomputeQuoteTotal(quote.id)
  const freshQuote = await prisma.productQuote.findUnique({ where: { id: quote.id }, include: { items: true } })

  // Generate a fresh Paystack link — never reuse old authorization_url
  const paymentLink = await generatePaymentLink(lead, freshQuote)

  if (!paymentLink) {
    // Notify admin so they can resend manually once Paystack is resolved
    sendTelegramMessage(
      `⚠️ <b>Paystack link could not be generated</b>\n\n` +
      `<b>Lead:</b> ${lead.fullName}\n` +
      `<b>Quote ID:</b> ...${freshQuote.id.slice(-8)}\n` +
      `<b>Total:</b> ₦${(freshQuote.totalAmount || 0).toLocaleString('en-NG')}\n` +
      `<b>Email:</b> ${lead.email || '—'}\n\n` +
      `Quote message sent with WhatsApp fallback. Regenerate from CRM once Paystack is available.`
    ).catch(() => {})
    console.warn(`[QuoteService] Paystack link generation failed | quoteId=${freshQuote.id} leadId=${leadId} — falling back to WhatsApp link`)
  }

  const message = buildDiagnosisAndQuoteMessage(lead, freshQuote, paymentLink)

  console.log(`[QuoteService] sending diagnosis+quote | leadId=${leadId} quoteId=${freshQuote.id} total=₦${freshQuote.totalAmount} hasPaymentLink=${!!paymentLink} checkoutUrl=${freshQuote.checkoutUrl || 'n/a'}`)

  const sendResult = await sendTelegramToUser(lead.telegramChatId, message, LEAD_BOT_TOKEN)
  const now = new Date()

  if (sendResult?.skipped) {
    throw new Error('Telegram bot token not configured')
  }

  if (!sendResult?.success) {
    const errMsg = JSON.stringify(sendResult?.error || 'unknown error')
    console.error(`[QuoteService] send failed | leadId=${leadId} error=${errMsg}`)
    throw new Error(`Telegram send failed: ${errMsg}`)
  }

  // Mark quote sent
  await prisma.productQuote.update({
    where: { id: quote.id },
    data:  { status: 'sent', sentAt: now },
  })

  // Update lead
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      quoteStatus:          'sent',
      productQuoteSentAt:   now,
      productOfferSent:     true,
      productOfferSentAt:   lead.productOfferSentAt || now,
      productOfferStatus:   'sent',
      productRecoSent:      true,
      productRecoSentAt:    lead.productRecoSentAt || now,
      productRecoStatus:    'sent',
      conversionPath:       'product_quote',
      conversionStage:      'offer_sent',
      conversationMode:     'product_reco_active',
      lastBotIntent:        'diagnosis_and_quote',
      lastMeaningfulBotAt:  now,
      lastConversionTriggerAt: now,
      // Phase 29: advance flow to quote_sent so guard allows payment questions
      currentFlow:          'product_quote_sent',
      lastFlowGuardReason:  null,
    },
  })

  // Log
  await prisma.messageLog.create({
    data: {
      type:            'lead',
      recordId:        leadId,
      channel:         'telegram',
      status:          'sent',
      auto:            false,
      triggerReason:   'diagnosis_and_quote_manual',
      recipient:       String(lead.telegramChatId),
      deliveryChannel: 'telegram',
      fallbackUsed:    false,
    },
  }).catch(e => console.error('[QuoteService] MessageLog write failed:', e.message))

  // Phase 29: log quote_sent event
  prisma.flowEventLog.create({
    data: {
      leadId,
      eventType: 'quote_sent_admin_approved',
      fromFlow:  'product_quote_pending_review',
      toFlow:    'product_quote_sent',
      reason:    'admin_reviewed_and_sent',
    },
  }).catch(() => {})

  console.log(`[ProductQuote] sent_by_admin leadId=${leadId} quoteId=${quote.id} msgId=${sendResult.data?.result?.message_id}`)

  return {
    quoteId:     quote.id,
    totalAmount: freshQuote.totalAmount,
    paymentLink,
    sentAt:      now,
  }
}

module.exports = {
  generateQuoteForLead,
  updateQuoteItem,
  approveQuote,
  markQuoteSent,
  getQuotesForLead,
  getLatestActiveQuote,
  recomputeQuoteTotal,
  sendDiagnosisAndQuote,
}
