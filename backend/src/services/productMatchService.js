'use strict'

const prisma = require('../lib/prisma')

// Maps primaryConcern → ordered category steps for morning + night routines
const CONCERN_STEP_MAP = {
  acne: {
    morning: ['cleanser', 'serum', 'moisturizer', 'sunscreen'],
    night:   ['cleanser', 'serum', 'moisturizer', 'spot_treatment'],
  },
  hyperpigmentation: {
    morning: ['cleanser', 'serum', 'moisturizer', 'sunscreen'],
    night:   ['cleanser', 'serum', 'moisturizer'],
  },
  dry_skin: {
    morning: ['cleanser', 'toner', 'serum', 'moisturizer', 'sunscreen'],
    night:   ['cleanser', 'oil', 'moisturizer'],
  },
  oily_skin: {
    morning: ['cleanser', 'toner', 'serum', 'moisturizer', 'sunscreen'],
    night:   ['cleanser', 'serum', 'moisturizer'],
  },
  sensitivity: {
    morning: ['cleanser', 'serum', 'moisturizer', 'sunscreen'],
    night:   ['cleanser', 'serum', 'moisturizer'],
  },
  eczema: {
    morning: ['cleanser', 'moisturizer'],
    night:   ['cleanser', 'moisturizer'],
  },
  stretch_marks: {
    morning: ['body', 'oil'],
    night:   ['body', 'oil'],
  },
  body_care: {
    morning: ['body', 'sunscreen'],
    night:   ['body', 'oil'],
  },
  routine_building: {
    morning: ['cleanser', 'serum', 'moisturizer', 'sunscreen'],
    night:   ['cleanser', 'serum', 'moisturizer'],
  },
}

function scoreProduct(product, { primaryConcern, secondaryConcern, skinTypes, sensitive, priceBand }) {
  let score = 0

  if (product.concernsSupported.includes(primaryConcern)) score += 40
  if (secondaryConcern && product.concernsSupported.includes(secondaryConcern)) score += 15

  const productSkinTypes = product.skinTypesSupported || []
  if (productSkinTypes.includes('all') || productSkinTypes.length === 0) {
    score += 10
  } else {
    if (skinTypes.some(st => productSkinTypes.includes(st))) score += 15
  }

  if (sensitive && product.sensitivityFriendly) score += 15
  if (sensitive && !product.sensitivityFriendly) score -= 10

  if (priceBand && product.priceBand === priceBand) score += 10
  if (priceBand === 'budget' && product.priceBand === 'mid-range') score -= 5
  if (priceBand === 'budget' && product.priceBand === 'premium') score -= 15

  score += (product.confidenceScore || 1.0) * 5

  if (product.stockStatus === 'in_stock') score += 5
  if (product.stockStatus === 'out_of_stock') score -= 20

  return Math.max(0, score)
}

/**
 * Match products to a lead's diagnosis profile.
 * Returns { morning, night, addons, totalMatched, concern, priceBand, skinTypes }
 */
async function matchProductsForLead(params) {
  const {
    primaryConcern = 'routine_building',
    secondaryConcern,
    skinType,
    budget,
    sensitive,
  } = params

  const skinTypes = []
  if (skinType) {
    const t = skinType.toLowerCase()
    if (/oily/.test(t)) skinTypes.push('oily')
    if (/dry/.test(t)) skinTypes.push('dry')
    if (/combination|combo/.test(t)) skinTypes.push('combination')
    if (/normal/.test(t)) skinTypes.push('normal')
    if (/sensitiv/.test(t)) skinTypes.push('sensitive')
  }
  if (skinTypes.length === 0) skinTypes.push('all')

  let priceBand = null
  if (budget) {
    const b = budget.toLowerCase()
    if (/budget|cheap|affordable|low/.test(b)) priceBand = 'budget'
    else if (/mid|moderate|medium/.test(b)) priceBand = 'mid-range'
    else if (/premium|high|luxury/.test(b)) priceBand = 'premium'
  }

  const concern = primaryConcern || 'routine_building'
  const stepMap = CONCERN_STEP_MAP[concern] || CONCERN_STEP_MAP.routine_building

  const concernFilter = [concern]
  if (secondaryConcern) concernFilter.push(secondaryConcern)

  const candidates = await prisma.skincareProduct.findMany({
    where: {
      isActive: true,
      availabilityStatus: { not: 'unavailable' },
      OR: [
        { concernsSupported: { hasSome: concernFilter } },
        { skinTypesSupported: { has: 'all' } },
      ],
    },
    orderBy: { confidenceScore: 'desc' },
    take: 100,
  })

  const scored = candidates.map(p => ({
    ...p,
    _score: scoreProduct(p, { primaryConcern: concern, secondaryConcern, skinTypes, sensitive: !!sensitive, priceBand }),
  }))

  function buildRoutine(steps) {
    const routine = []
    const used = new Set()
    for (const step of steps) {
      const best = scored
        .filter(p => p.category === step && !used.has(p.id))
        .sort((a, b) => b._score - a._score)[0]
      if (best) {
        routine.push(best)
        used.add(best.id)
      }
    }
    return routine
  }

  const morning = buildRoutine(stepMap.morning)
  const night   = buildRoutine(stepMap.night)

  const usedIds = new Set([...morning, ...night].map(p => p.id))
  const addons = scored
    .filter(p => !usedIds.has(p.id) && p._score >= 30)
    .sort((a, b) => b._score - a._score)
    .slice(0, 3)

  return { morning, night, addons, totalMatched: candidates.length, concern, priceBand, skinTypes }
}

async function matchProductsForLeadId(leadId) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } })
  if (!lead) return null

  return matchProductsForLead({
    primaryConcern:   lead.primaryConcern,
    secondaryConcern: lead.secondaryConcern,
    routineType:      lead.routineType,
    skinType:         lead.telegramSkinType,
    budget:           lead.telegramBudget,
    sensitive:        /sensitiv|react/.test((lead.telegramSensitivity || '') + (lead.telegramSkinType || '')),
  })
}

module.exports = { matchProductsForLead, matchProductsForLeadId, scoreProduct }
