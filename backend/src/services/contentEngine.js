'use strict'

// ── Concern detection ─────────────────────────────────────────────────────────

const CONCERN_PATTERNS = [
  { pattern: /acne|pimple|breakout|blemish|spot/i,                     concern: 'acne' },
  { pattern: /hyperpigment|dark spot|pigment|dark mark|discolou?r/i,   concern: 'hyperpigmentation' },
  { pattern: /stretch mark|stretchmark/i,                              concern: 'stretch_marks' },
  { pattern: /dry|dehydrat|tight|flak/i,                               concern: 'dry_skin' },
  { pattern: /sensitiv|react|redness|irritat|rash/i,                   concern: 'sensitive_skin' },
  { pattern: /glow|bright|even tone|radiant|dull/i,                    concern: 'brightening' },
  { pattern: /routine|regimen|skincare|cleanser|moisturiser/i,         concern: 'routine' },
  { pattern: /body|back|chest|arm|leg|stomach/i,                       concern: 'body_care' },
]

function detectConcern(text) {
  const t = String(text || '')
  for (const { pattern, concern } of CONCERN_PATTERNS) {
    if (pattern.test(t)) return concern
  }
  return 'general'
}

// ── Content template library ──────────────────────────────────────────────────

const CONTENT_TEMPLATES = {

  acne: {
    hooks: [
      "If you're still breaking out after trying EVERYTHING, this is why.",
      "Acne is not caused by dirty skin — here is what is actually happening.",
      "Stop using these 3 things if you have acne-prone skin.",
      "Why your cleanser might be making your acne worse (not better).",
    ],
    videoIdeas: [
      "The 3-step acne routine that actually clears skin — no expensive products needed",
      "Salicylic acid vs benzoyl peroxide — which one do you actually need?",
      "Why your moisturiser is making your acne worse",
      "The acne mistakes I see every single day (and how to fix them)",
    ],
    captions: [
      "Struggling with acne? Your skin barrier might be the real problem. Over-washing and harsh actives destroy the barrier — and broken barrier = more breakouts.\n\nHere's the fix:\n1. Gentle cleanser\n2. Niacinamide 10%\n3. Lightweight moisturiser\n\nLink in bio to get your personalised routine.",
      "This one ingredient cleared my client's skin in 3 weeks. It is not what you think.\n\nNiacinamide — the most underrated acne ingredient. Works on oily skin, dry skin, sensitive skin. No irritation.\n\nLink in bio for your skin analysis.",
    ],
  },

  hyperpigmentation: {
    hooks: [
      "You are treating your dark spots wrong — and that is why they keep coming back.",
      "The cheapest brightening ingredient outperforms ₦20,000 creams.",
      "Why you MUST wear SPF every day if you have dark skin or dark spots.",
      "3 ingredients that actually fade dark spots — no bleaching required.",
    ],
    videoIdeas: [
      "Vitamin C + SPF: the morning duo that fades dark spots faster than anything else",
      "The truth about skin bleaching creams (what they never tell you)",
      "Alpha arbutin vs kojic acid — which one actually works for Nigerian skin?",
      "Why your dark spots come back — and how to stop the cycle",
    ],
    captions: [
      "Dark spots are almost always preventable. SPF every morning is the most underrated skincare step.\n\nNo SPF = all your brightening products are undone by daily sun exposure.\n\nDrop a ✨ if you want my full brightening routine breakdown.",
      "This 2-product combo fades hyperpigmentation in 8 weeks — and costs under ₦5,000.\n\n1. Vitamin C serum (morning)\n2. Alpha arbutin serum (morning)\n+ SPF 50 every day without exception\n\nLink in bio to find out what YOUR skin needs.",
    ],
  },

  stretch_marks: {
    hooks: [
      "Stretch marks do not have to be permanent — here is what actually works.",
      "Stop wasting money on stretch mark creams that do nothing.",
      "The best time to treat stretch marks (most people miss this window completely).",
      "Red stretch marks vs white stretch marks — the treatment is completely different.",
    ],
    videoIdeas: [
      "Fresh vs old stretch marks — what treatment actually works for each stage",
      "The 5-minute massage technique that visibly improves stretch marks in 4 weeks",
      "Bio-Oil, Palmer's, or rosehip — honest review after 100+ client results",
      "Why stretch marks appear and what that means for treatment",
    ],
    captions: [
      "New stretch marks (red/purple) respond 3–4x better to treatment than old silver ones.\n\nIf yours are still red — start NOW. This is your window.\n\nLink in bio for your personalised skin plan.",
      "Consistency beats expensive treatments every time.\n\nRosehip oil + 5 minute massage + moisturising daily = visible improvement in 6–8 weeks.\n\nComment 'routine' and I'll walk you through exactly how to do it.",
    ],
  },

  dry_skin: {
    hooks: [
      "Your skin is dehydrated, not just dry — and there is a difference that changes everything.",
      "This ₦2,000 product hydrates better than a ₦15,000 cream.",
      "If your skin feels tight after cleansing, your cleanser is the problem.",
      "Why drinking more water is not fixing your dry skin.",
    ],
    videoIdeas: [
      "The layering technique that doubles your moisturiser's effectiveness",
      "Hyaluronic acid: why you might be using it completely wrong",
      "The 5-minute hydration routine for chronically dry skin",
      "Dehydrated vs dry skin — how to tell the difference and treat them correctly",
    ],
    captions: [
      "Dry skin tip: apply your serum to damp skin, not dry skin. You'll thank me later.\n\nHyaluronic acid draws moisture FROM the environment into your skin. But if your skin is dry, it draws it from deeper skin layers instead — making dryness worse.\n\nDamp skin = hyaluronic acid actually works.\n\nDrop a 💧 if your skin is always thirsty.",
      "The wrong cleanser is destroying your skin barrier. Most foaming cleansers are too harsh for dry skin types.\n\nSwitch to a cream cleanser and your skin will change in 2 weeks.\n\nLink in bio for your skin type recommendation.",
    ],
  },

  sensitive_skin: {
    hooks: [
      "If your skin reacts to everything, the problem is your barrier — not your skin type.",
      "Stop layering 10 products if you have sensitive skin. Here is the actual fix.",
      "The 1 ingredient that calms reactive skin without any irritation.",
      "Sensitive skin does not mean your skin is weak — here is what it actually means.",
    ],
    videoIdeas: [
      "How to repair a damaged skin barrier in 2 weeks (step by step)",
      "Sensitive skin ingredient blacklist — avoid these permanently",
      "Centella asiatica: why every sensitive skin needs this ingredient",
      "How to introduce actives to sensitive skin without reacting",
    ],
    captions: [
      "Sensitive skin does not mean you are stuck with boring skincare forever.\n\nIt means you need to repair your barrier first — then you can use actives safely.\n\nLink in bio to get your personalised step-by-step plan.",
      "Less is genuinely more for sensitive skin.\n\nFewer products = fewer ingredients = lower reaction risk.\n\nThe 3-step routine for sensitive skin:\n1. Gentle cream cleanser\n2. Ceramide moisturiser\n3. Mineral SPF\n\nThat is it. Add from there slowly.",
    ],
  },

  brightening: {
    hooks: [
      "Your skin is NOT supposed to look dull. Here is the actual fix.",
      "Glass skin is not genetics — it is a 3-step routine done consistently.",
      "This morning step costs ₦1,500 and outperforms luxury facials.",
      "Why your skin looks dull by 2pm (and how to fix it overnight).",
    ],
    videoIdeas: [
      "The glow routine that works for every skin type — no filters needed",
      "AHA exfoliation: the secret to instant glow (and how not to overdo it)",
      "Morning routine for glowing skin — from 500+ skin consultations",
      "Why hydration = glow (and how to actually get hydrated skin)",
    ],
    captions: [
      "Glow is not luck. It is:\n✓ Hydration\n✓ Gentle exfoliation (2–3x/week)\n✓ Vitamin C in the morning\n✓ SPF every single day\n✓ Consistency over weeks, not days\n\nDrop a ✨ and I'll send you the full breakdown.",
      "3 products for glass skin under ₦8,000 total:\n1. Vitamin C serum\n2. Lactic acid toner (2–3x/week at night)\n3. SPF 50+\n\nSave this. Share it. Your skin will thank you.\n\nLink in bio for your skin type recommendation.",
    ],
  },

  routine: {
    hooks: [
      "The ORDER you apply skincare matters more than the products you use.",
      "You do not need 10 steps. Here is the minimal routine that does everything.",
      "Most people skip the most important step in a skincare routine.",
      "Building a skincare routine from scratch? Start here.",
    ],
    videoIdeas: [
      "Build your first skincare routine from scratch — morning and night",
      "Skincare ingredients you should NEVER mix (and why)",
      "Budget skincare routine that works as well as luxury — side by side comparison",
      "The correct order to layer skincare (most people get this wrong)",
    ],
    captions: [
      "Morning skincare routine in 4 steps:\n1. Gentle cleanser\n2. Vitamin C serum\n3. Moisturiser\n4. SPF 30+\n\nThat is literally it. Everything else is extra.\n\nSave this for your next skincare shopping trip.",
      "Your skin does not need 15 products. It needs the right 3 — used consistently for weeks.\n\nLink in bio to find YOUR routine based on your skin type and concern.",
    ],
  },

  body_care: {
    hooks: [
      "Your body skin needs skincare too — here is where most people go wrong.",
      "Why your body lotion is not working (and what to use instead).",
      "The 2-minute body routine that transforms your skin in 4 weeks.",
      "Dark marks on your body? Here is the simple fix.",
    ],
    videoIdeas: [
      "The body care routine for glowing skin from head to toe",
      "Best body oils for stretch marks, dark marks, and dry skin — ranked",
      "Why you should moisturise damp skin (body lotion done correctly)",
      "AHA body wash: the lazy person's guide to smooth, glowing body skin",
    ],
    captions: [
      "Body care tip: apply your lotion within 2 minutes of showering — on damp skin.\n\nThe difference is dramatic. Dry skin absorbs almost nothing. Damp skin absorbs everything.\n\nSave this and try it tonight.",
      "Glowing body skin is not luck.\n\nIt is exfoliation 2–3x/week + daily moisturiser on damp skin + SPF on exposed areas.\n\nLink in bio for product recommendations for your skin type.",
    ],
  },

  general: {
    hooks: [
      "The skincare industry profits from your confusion. Here is what you actually need.",
      "I have consulted hundreds of clients. Here is the one habit that transforms skin fastest.",
      "Stop buying new products. Fix your routine first.",
      "The biggest skincare mistake I see every single day.",
    ],
    videoIdeas: [
      "The biggest skincare mistakes I see every day — and how to fix them",
      "Skincare ingredients ranked by effectiveness — what is actually worth spending on",
      "How to read a skincare label so you stop wasting money",
      "Why expensive skincare is not always better skincare",
    ],
    captions: [
      "The most common skincare mistake? Skipping SPF.\n\nIt reverses everything else you do. Every. Single. Day.\n\nSave this as a reminder. Your future skin will thank you.",
      "Skincare is not complicated when you know the principles:\n✓ Cleanse\n✓ Treat (serum for your concern)\n✓ Moisturise\n✓ SPF every morning\n\nConsistency matters more than any product. Link in bio if you want a personalised plan.",
    ],
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickRandom(arr) {
  if (!arr || arr.length === 0) return ''
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generates content ideas from a batch of scraped Instagram comments.
 *
 * Groups comments by detected skin concern, ranks by volume, and returns
 * one unique content idea set per concern — ready for content planning.
 *
 * @param {string[]} comments  Array of raw comment text strings
 * @returns {{ concern: string, commentCount: number, hook: string, videoIdea: string, caption: string, cta: string }[]}
 */
function generateContentFromComments(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return []

  // Tally concern frequency
  const tally = {}
  for (const comment of comments) {
    const c = detectConcern(comment)
    tally[c] = (tally[c] || 0) + 1
  }

  // Sort by volume (highest first) and build one idea per concern
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([concern, count]) => {
      const tpl = CONTENT_TEMPLATES[concern] || CONTENT_TEMPLATES.general
      return {
        concern,
        commentCount: count,
        hook: pickRandom(tpl.hooks),
        videoIdea: pickRandom(tpl.videoIdeas),
        caption: pickRandom(tpl.captions),
        cta: 'Link in bio to get your personal routine — free skin analysis',
      }
    })
}

module.exports = { generateContentFromComments, detectConcern }
