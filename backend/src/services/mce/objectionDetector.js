'use strict'

/**
 * objectionDetector.js — Phase 34 (MCE)
 *
 * Deterministic regex-based objection detector. Inspects an inbound message
 * and returns the first matching objection type, or null. Used by the
 * conversation brain hook to record objections to the lead timeline and to
 * pick the right MCE follow-up variant.
 *
 * Types:
 *   pricing      — too expensive / can't afford / cheaper / discount
 *   trust        — suspicious / scam / proof / reviews / legit
 *   timing       — later / not now / next month / busy
 *   skepticism   — does it work / doubts / tried before
 *
 * Pure function, no I/O.
 */

const PATTERNS = [
  {
    type: 'pricing',
    re: [
      /\btoo\s+(expensive|much|costly|pricey)\b/i,
      /\bcan'?t\s+afford\b/i,
      /\bno\s+money\b/i,
      /\bnot\s+(in|within)\s+(my\s+)?budget\b/i,
      /\bover\s+my\s+budget\b/i,
      /\bmoney\s+(is\s+)?(tight|small|low)\b/i,
      /\bcheaper\b/i,
      /\bdiscount\b/i,
      /\bany\s+(offer|promo|deal)\b/i,
      /\bany\s+(price\s+)?reduction\b/i,
      /\babeg\s+.*\b(expensive|costly|much|reduce)\b/i,
      /\bcost\s+too\s+much\b/i,
      /\b(₦|naira)\b.*\b(too|much|expensive)\b/i,
      /\breduce\s+(the\s+)?(price|amount)\b/i,
    ],
  },
  {
    type: 'trust',
    re: [
      /\b(is\s+this|are\s+you|are\s+y'?all)\s+(a\s+)?(scam|fraud|legit|real)\b/i,
      /\b(legit|fake|scam|fraud)\b/i,
      /\bsend\s+(me\s+)?(proof|reviews?|testimonials?)\b/i,
      /\bany\s+(proof|reviews?|results?)\b/i,
      /\bdo\s+you\s+have\s+(proof|reviews?|testimonials?)\b/i,
      /\bbefore\s*(\/|and)\s*after\b/i,
      /\b(trust|trustworthy|trusted)\b/i,
      /\bhow\s+(do\s+i|can\s+i)\s+know\b/i,
      /\bbeen\s+scammed\b/i,
      /\beverybody\s+is\s+a\s+scam\b/i,
    ],
  },
  {
    type: 'timing',
    re: [
      /\bmaybe\s+later\b/i,
      /\bnot\s+(now|today|yet|ready)\b/i,
      /\b(next\s+(month|week|year)|later\s+this\s+(month|year))\b/i,
      /\bsome\s+other\s+time\b/i,
      /\bafter\s+(salary|payday|month\s+end)\b/i,
      /\bend\s+of\s+(the\s+)?month\b/i,
      /\b(busy|swamped)\s+(right\s+now|now|at\s+the\s+moment)\b/i,
      /\bremind\s+me\s+(later|next)\b/i,
      /\bget\s+back\s+to\s+you\b/i,
      /\bwill\s+(reach\s+out|come\s+back)\b/i,
    ],
  },
  {
    type: 'skepticism',
    re: [
      /\bdoes\s+(it|this)\s+(actually\s+|really\s+)?work\b/i,
      /\bwill\s+it\s+work\b/i,
      /\b(tried|used)\s+(everything|so\s+many|many\s+products)\b/i,
      /\bnothing\s+(worked|works)\b/i,
      /\bnot\s+sure\s+(if|it\s+will)\b/i,
      /\bi'?m\s+sceptical\b/i,
      /\bi'?m\s+skeptical\b/i,
      /\bdoubt(ful)?\b/i,
      /\bafraid\s+(it\s+won'?t|of)\b/i,
      /\bhow\s+long\s+(till|before|until)\s+i\s+see\b/i,
    ],
  },
]

function detect(text) {
  if (!text || typeof text !== 'string') return null
  const t = text.trim()
  if (!t) return null

  for (const { type, re } of PATTERNS) {
    for (const r of re) {
      const m = t.match(r)
      if (m) {
        return {
          type,
          matchedPattern: r.source,
          matchedText:    m[0],
        }
      }
    }
  }
  return null
}

/**
 * Returns the human label for a type — used in the dashboard.
 */
function label(type) {
  return ({
    pricing:    'Pricing',
    trust:      'Trust',
    timing:     'Timing',
    skepticism: 'Skepticism',
  })[type] || type
}

module.exports = { detect, label }
