'use strict'

const prisma = require('../lib/prisma')

const FULFILLMENT_STATUSES = ['pending_fulfillment', 'packed', 'delivered', 'cancelled']

async function getFulfillmentOrders({ leadId, status, page = 1, limit = 50 } = {}) {
  const where = {}
  if (leadId) where.leadId = leadId
  if (status) where.status = status

  const [total, orders] = await Promise.all([
    prisma.fulfillmentOrder.count({ where }),
    prisma.fulfillmentOrder.findMany({
      where,
      include: {
        lead:               { select: { id: true, fullName: true, email: true, phone: true, telegramChatId: true } },
        quote:              { select: { id: true, totalAmount: true, currency: true } },
        paymentTransaction: { select: { id: true, paystackReference: true, paidAt: true, channel: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip:    (Number(page) - 1) * Number(limit),
      take:    Number(limit),
    }),
  ])

  return { orders, total, page: Number(page), limit: Number(limit) }
}

async function updateFulfillmentStatus(orderId, status) {
  if (!FULFILLMENT_STATUSES.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${FULFILLMENT_STATUSES.join(', ')}`)
  }

  const order = await prisma.fulfillmentOrder.update({
    where:   { id: orderId },
    data:    { status, updatedAt: new Date() },
    include: { lead: { select: { id: true, fullName: true } } },
  })

  if (order.quoteId) {
    await prisma.productQuote.update({
      where: { id: order.quoteId },
      data:  { fulfillmentStatus: status },
    }).catch(e => console.error('[FulfillmentService] quote sync failed:', e.message))
  }

  console.log(`[Fulfillment] order=${orderId} → status=${status}`)
  return order
}

async function getPaymentTransactions({ leadId, page = 1, limit = 50 } = {}) {
  const where = {}
  if (leadId) where.leadId = leadId

  const [total, transactions] = await Promise.all([
    prisma.paymentTransaction.count({ where }),
    prisma.paymentTransaction.findMany({
      where,
      include: {
        lead:  { select: { id: true, fullName: true, email: true } },
        quote: { select: { id: true, totalAmount: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip:    (Number(page) - 1) * Number(limit),
      take:    Number(limit),
    }),
  ])

  return { transactions, total, page: Number(page), limit: Number(limit) }
}

module.exports = { getFulfillmentOrders, updateFulfillmentStatus, getPaymentTransactions }
