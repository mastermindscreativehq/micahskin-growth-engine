'use strict'

/**
 * resellerIntentService.js — Phase 34 (MCE)
 *
 * Detects whether a lead is a *reseller / business builder* rather than an
 * end-customer student. The conversation brain already detects "academy
 * interest" but conflates students-fixing-skin and aspiring-resellers — MCE
 * splits these because they require different funnel paths and pricing
 * conversations.
 *
 * Pure function, no I/O.
 *
 *   detect(text) →
 *     { reseller: boolean, score: 0-100, signals: [string] }
 */

const RESELLER_SIGNALS = [
  { weight: 35, re: /\b(start|launch|build)\s+(my\s+|a\s+)?(skincare|beauty|cosmetics?)\s+(brand|business|line|company|empire)\b/i, label: 'start_brand' },
  { weight: 30, re: /\bstart\s+my\s+own\b/i, label: 'start_my_own' },
  { weight: 30, re: /\bbecome\s+a\s+(reseller|distributor|partner|stockist)\b/i, label: 'become_reseller' },
  { weight: 30, re: /\b(reseller|distributor|wholesale|wholesaler)\b/i, label: 'reseller_word' },
  { weight: 28, re: /\b(open|run)\s+(my\s+)?(skincare|beauty)\s+(store|shop)\b/i, label: 'open_shop' },
  { weight: 25, re: /\bsell\s+(skincare|products|cosmetics|beauty)\b/i, label: 'sell_products' },
  { weight: 25, re: /\bbulk\s+(buy|order|purchase|price|pricing)\b/i, label: 'bulk_buy' },
  { weight: 22, re: /\b(white\s*label|private\s*label)\b/i, label: 'private_label' },
  { weight: 22, re: /\b(my\s+)?customers?\b/i, label: 'has_customers' },
  { weight: 22, re: /\b(my\s+)?clients?\b/i, label: 'has_clients' },
  { weight: 20, re: /\b(my\s+)?(salon|spa|clinic|store|shop)\b/i, label: 'owns_business' },
  { weight: 20, re: /\b(business\s+)?(opportunity|partnership)\b/i, label: 'partnership' },
  { weight: 18, re: /\b(stock|stocking)\s+(your|micahskin)\s+products?\b/i, label: 'stock_products' },
  { weight: 18, re: /\b(make|earn)\s+(money|income)\s+(from|with|selling)\b/i, label: 'earn_from_selling' },
  { weight: 15, re: /\b(brand|business)\s+(building|growth|scale|launch)\b/i, label: 'brand_building' },
  { weight: 15, re: /\b(side\s+)?hustle\b/i, label: 'hustle' },
  { weight: 15, re: /\bagent\b/i, label: 'agent' },
  { weight: 12, re: /\b(skincare|beauty)\s+(entrepreneur|founder|owner|ceo|boss)\b/i, label: 'entrepreneur_self' },
  { weight: 12, re: /\bonline\s+(store|shop|business)\b/i, label: 'online_store' },
  { weight: 10, re: /\b(plug|drop)\s+(me|us)\s+in\b/i, label: 'plug_me' },
]

// Anti-signals — "I want to fix MY skin" cancels reseller weight.
const STUDENT_ANTI_SIGNALS = [
  /\b(my\s+|fix\s+my\s+)skin\b/i,
  /\bi\s+(have|am\s+suffering\s+from|got)\s+(acne|hyperpigmentation|stretch\s+marks)\b/i,
  /\bplease\s+help\s+(me\s+)?with\s+my\s+(skin|face|acne|spots)\b/i,
  /\bwhat\s+(should|can)\s+i\s+use\s+for\s+my\b/i,
]

function detect(text) {
  if (!text || typeof text !== 'string') {
    return { reseller: false, score: 0, signals: [] }
  }

  let score = 0
  const signals = []
  for (const { weight, re, label } of RESELLER_SIGNALS) {
    if (re.test(text)) {
      score += weight
      signals.push(label)
    }
  }

  let antiPenalty = 0
  for (const re of STUDENT_ANTI_SIGNALS) {
    if (re.test(text)) antiPenalty += 12
  }
  score = Math.max(0, score - antiPenalty)
  score = Math.min(100, score)

  return {
    reseller: score >= 30,
    score,
    signals,
    antiPenalty,
  }
}

module.exports = { detect }
