'use strict'

// ── Normalizers ───────────────────────────────────────────────────────────────

function normalizeSkinType(raw = '') {
  const t = raw.toLowerCase()
  if (/oily/.test(t)) return 'oily'
  if (/dry/.test(t)) return 'dry'
  if (/combination|combo/.test(t)) return 'combination'
  if (/sensitive/.test(t)) return 'sensitive'
  return 'normal'
}

function normalizeConcern(raw = '') {
  const t = raw.toLowerCase()
  if (/acne|pimple|breakout|blemish|spot/.test(t)) return 'acne'
  if (/hyperpigment|dark spot|pigment|dark mark|discolou?r|uneven/.test(t)) return 'hyperpigmentation'
  if (/stretch mark|stretchmark/.test(t)) return 'stretch_marks'
  if (/dry|dehydrat|flak|tight skin/.test(t)) return 'dry_skin'
  if (/sensitiv|react|irritat|redness|rash|sting/.test(t)) return 'sensitive_skin'
  if (/body|back|chest|arm|leg|stomach/.test(t)) return 'body_care'
  if (/glow|bright|even tone|radiant|luminous/.test(t)) return 'brightening'
  return 'general'
}

function isSensitive(sensitivityRaw = '', skinTypeRaw = '') {
  const t = (sensitivityRaw + ' ' + skinTypeRaw).toLowerCase()
  return /yes|sensitive|react|easily|irritat|rash|sting|burn|fragile/.test(t)
}

function getBudget(raw = '') {
  const t = raw.toLowerCase()
  if (/premium|high|luxury|top/.test(t)) return 'premium'
  if (/mid|middle|moderate|average/.test(t)) return 'mid'
  return 'budget'
}

// ── Clinical templates per skin condition ─────────────────────────────────────
//
// Each entry: { diagnosis, morning[], night[], products[], notes[] }
// Keys: condition_skintype (fall back to condition if skin-type variant missing)

const TEMPLATES = {

  // ── ACNE ────────────────────────────────────────────────────────────────────

  acne_oily: {
    diagnosis: 'Oily, acne-prone skin with excess sebum production causing congested pores and active breakouts.',
    morning: [
      'Salicylic acid (BHA) foaming cleanser',
      'Niacinamide 10% serum — controls oil + reduces post-acne marks',
      'Oil-free lightweight gel moisturiser',
      'SPF 30+ non-comedogenic sunscreen (non-negotiable)',
    ],
    night: [
      'Salicylic acid or benzoyl peroxide 2.5% cleanser',
      'Niacinamide 10% + Zinc serum',
      'Benzoyl peroxide 2.5% spot treatment on active spots only',
      'Lightweight gel moisturiser',
    ],
    products: [
      'CeraVe SA Cleanser (budget-friendly, effective BHA)',
      'The Ordinary Niacinamide 10% + Zinc',
      'Neutrogena Oil-Free Moisture (lightweight)',
      'La Roche-Posay Toleriane Double Repair (for barrier nights)',
    ],
    notes: [
      'Do not over-wash — twice daily maximum or you strip the barrier and trigger more oil.',
      'Avoid heavy oils and thick creams entirely.',
      'Introduce retinol only after 4+ weeks of stabilising with niacinamide.',
    ],
  },

  acne_dry: {
    diagnosis: 'Dry, acne-prone skin — dehydration is triggering rebound oil production and breakouts. Moisture is the priority before actives.',
    morning: [
      'Gentle cream low-pH cleanser (not foaming)',
      'Hyaluronic acid serum applied to damp skin',
      'Niacinamide 5% serum',
      'Ceramide-rich moisturiser',
      'SPF 30+ preferably in a hydrating formula',
    ],
    night: [
      'Cream or oil cleanser',
      'Hyaluronic acid serum',
      'Benzoyl peroxide 2.5% spot treatment (spots only, not all over)',
      'Ceramide-rich night moisturiser',
    ],
    products: [
      'CeraVe Hydrating Cleanser',
      'The Ordinary Hyaluronic Acid 2% + B5',
      'CeraVe Moisturising Cream',
      'La Roche-Posay Effaclar Duo (spot treatment)',
    ],
    notes: [
      'Moisture is your priority — well-hydrated skin produces less excess oil and heals faster.',
      'Use low-strength actives only to avoid stripping a compromised barrier.',
      'Always patch test new products on the inner forearm first.',
    ],
  },

  acne_combination: {
    diagnosis: 'Combination skin with acne — oily T-zone triggering breakouts while cheeks remain normal or dry. Zone-specific treatment required.',
    morning: [
      'Gel or low-pH cleanser',
      'Niacinamide 10% serum (full face)',
      'Lightweight moisturiser on dry zones, skip or minimal on T-zone',
      'Oil-free SPF 30+',
    ],
    night: [
      'Salicylic acid cleanser focused on T-zone',
      'Retinol 0.2–0.3% serum 2–3x/week on breakout zones',
      'Spot treatment on active spots',
      'Light moisturiser all over',
    ],
    products: [
      'CeraVe Foaming Cleanser',
      'The Ordinary Niacinamide 10% + Zinc',
      'Neutrogena Rapid Clear Spot Gel',
      'Paula\'s Choice 1% Retinol Booster (for night)',
    ],
    notes: [
      'Multi-mask weekly: clay mask on T-zone, hydrating sheet mask on dry areas.',
      'Use blotting papers during the day instead of powder — powder blocks pores.',
      'Never skip moisturiser — even combination skin needs it.',
    ],
  },

  acne_sensitive: {
    diagnosis: 'Sensitive, acne-prone skin — inflammation and breakouts are worsened by harsh actives. Gentle barrier-first approach required.',
    morning: [
      'Ultra-gentle fragrance-free cream cleanser',
      'Centella asiatica serum or azelaic acid 10% (calms + treats acne)',
      'Fragrance-free hydrating moisturiser with ceramides',
      'Mineral SPF (zinc oxide or titanium dioxide only)',
    ],
    night: [
      'Gentle micellar water or oil cleanser',
      'Centella serum or panthenol-rich serum',
      'Niacinamide 5% — calms redness + reduces breakout frequency',
      'Soothing barrier repair cream',
    ],
    products: [
      'COSRX Low pH Good Morning Gel Cleanser',
      'Purito Centella Unscented Serum',
      'La Roche-Posay Toleriane Double Repair Moisturiser',
      'EltaMD UV Clear SPF 46 (mineral, fragrance-free)',
    ],
    notes: [
      'Avoid fragrance, alcohol, essential oils, and high-strength actives entirely.',
      'Introduce ONE new product at a time — wait 2 weeks before adding another.',
      'Azelaic acid is significantly gentler than retinol and salicylic acid for sensitive acne skin.',
    ],
  },

  acne_normal: {
    diagnosis: 'Normal skin with intermittent acne — breakouts are likely hormonal or product-related rather than chronic sebum excess.',
    morning: [
      'Gentle gel cleanser',
      'Niacinamide 10% serum',
      'Lightweight moisturiser',
      'SPF 30+',
    ],
    night: [
      'Same gentle cleanser',
      'Retinol 0.2% serum 2x/week',
      'Moisturiser',
    ],
    products: [
      'CeraVe Foaming Cleanser',
      'The Ordinary Niacinamide 10%',
      'The Ordinary Granactive Retinoid 2% Emulsion',
    ],
    notes: [
      'Audit your current products for comedogenic (pore-clogging) ingredients.',
      'Hormonal acne (chin/jawline) may need internal support — consult a doctor.',
    ],
  },

  // ── HYPERPIGMENTATION ────────────────────────────────────────────────────────

  hyperpigmentation: {
    diagnosis: 'Post-inflammatory hyperpigmentation or sun-induced dark spots causing uneven skin tone. Brightening actives + mandatory SPF are the treatment foundation.',
    morning: [
      'Gentle brightening cleanser or low-pH cleanser',
      'Vitamin C 10–20% serum — antioxidant protection + tyrosinase inhibitor',
      'Alpha arbutin 2% serum (layer on top of vitamin C)',
      'SPF 50+ (non-negotiable — UV exposure re-activates melanin production)',
    ],
    night: [
      'Double cleanse: oil cleanser then gentle water cleanser',
      'AHA toner (glycolic or lactic acid) 2–3x/week — exfoliates dark cells',
      'Niacinamide 10% serum',
      'Retinol 0.2–0.5% serum on alternating nights',
      'Rich moisturiser to seal',
    ],
    products: [
      'The Ordinary Vitamin C 23% + HA Spheres (or Timeless 20% Vitamin C for value)',
      'The Ordinary Alpha Arbutin 2% + HA',
      'Paula\'s Choice 8% AHA Toner',
      'La Roche-Posay Anthelios XL SPF 50+',
    ],
    notes: [
      'SPF is the single most important step — without it, every brightening product you use is undone by daily UV exposure.',
      'Vitamin C in the morning + AHA at night = the most effective two-step brightening stack.',
      'Results take 8–12 weeks of daily consistency — do not switch products mid-way.',
    ],
  },

  // ── STRETCH MARKS ────────────────────────────────────────────────────────────

  stretch_marks: {
    diagnosis: 'Stretch marks from rapid skin stretching. New (red/purple) marks respond significantly better to treatment than old (silver/white) marks.',
    morning: [
      'Gentle pH-balanced body wash',
      'Body lotion with centella asiatica or shea butter — apply to damp skin',
      'SPF 30+ on any exposed mark areas',
    ],
    night: [
      'Rosehip oil or marula oil — massage into marks for 5 minutes to boost circulation',
      'Retinol body cream 0.1–0.3% on older marks (2–3x/week only)',
      'Occlusive wrap (cling film or clothing) after oil for 30 minutes to boost penetration',
    ],
    products: [
      'Bio-Oil Specialist Skincare Oil (proven for new marks)',
      'Palmer\'s Cocoa Butter Stretch Mark Cream',
      'The Ordinary Granactive Retinoid 2% Body Emulsion (for older marks)',
    ],
    notes: [
      'Massage is as important as the product — it improves blood flow and breaks down scar tissue.',
      'Fresh red/purple marks (under 6 months) respond 3–4x better than mature silver marks.',
      'Hydrate daily — dry skin makes stretch marks visually worse.',
      'Retinol is NOT safe during pregnancy or breastfeeding.',
    ],
  },

  // ── DRY SKIN ─────────────────────────────────────────────────────────────────

  dry_skin: {
    diagnosis: 'Chronic skin dehydration and a compromised skin barrier causing persistent tightness, flaking, and a dull appearance.',
    morning: [
      'Cream or oil cleanser — never foaming',
      'Hyaluronic acid serum applied to damp skin to seal moisture in',
      'Ceramide-rich moisturiser',
      'SPF in a hydrating formula (avoid alcohol-based SPFs)',
    ],
    night: [
      'Oil cleanser to gently remove the day\'s debris without stripping',
      'Hyaluronic acid serum (damp skin again)',
      'Peptide or ceramide-rich serum',
      'Rich emollient night cream',
      'Optional: thin layer of Vaseline on very dry patches (skin slugging)',
    ],
    products: [
      'CeraVe Hydrating Cleanser',
      'The Ordinary Hyaluronic Acid 2% + B5',
      'CeraVe Moisturising Cream (one of the best value barrier creams)',
      'Weleda Skin Food (occlusive for very dry patches)',
    ],
    notes: [
      'Always apply serums and moisturiser to damp — not dry — skin for maximum hydration.',
      'Avoid hot water when cleansing — it strips the skin\'s natural lipids.',
      'Humidifier in your bedroom overnight helps significantly for persistent dry skin.',
    ],
  },

  // ── SENSITIVE SKIN ───────────────────────────────────────────────────────────

  sensitive_skin: {
    diagnosis: 'Reactive, barrier-compromised skin prone to redness, stinging, and adverse reactions. Barrier repair is the foundation before any actives.',
    morning: [
      'Fragrance-free micellar water or ultra-gentle cream cleanser',
      'Centella asiatica serum or simple moisturiser with ceramides',
      'Mineral SPF with zinc oxide or titanium dioxide only (no chemical UV filters)',
    ],
    night: [
      'Gentle oil or cream cleanser',
      'Centella or panthenol-based barrier repair serum',
      'Rich fragrance-free barrier moisturiser',
    ],
    products: [
      'La Roche-Posay Toleriane Hydrating Gentle Cleanser',
      'Avene Cicalfate+ Restorative Protective Cream',
      'EltaMD UV Clear SPF 46 (mineral, fragrance-free)',
      'Purito Centella Unscented Serum',
    ],
    notes: [
      'Fewer products = lower chance of reaction. Build up slowly.',
      'Permanently avoid: fragrance, alcohol (denat), essential oils, witch hazel, strong acids.',
      'Patch test every product on inner forearm for 48 hours before applying to face.',
      'Only introduce actives after 4+ weeks of stable barrier function.',
    ],
  },

  // ── BODY CARE ────────────────────────────────────────────────────────────────

  body_care: {
    diagnosis: 'Body skin requiring consistent care — hydration, gentle exfoliation, and targeted treatment for tone and texture concerns.',
    morning: [
      'pH-balanced body wash (avoid harsh sulphate soaps)',
      'Body lotion or cream — apply immediately after shower on damp skin',
      'SPF 30+ on exposed areas: chest, neck, arms, hands',
    ],
    night: [
      'Exfoliating body wash with lactic acid or salicylic acid — 2–3x/week',
      'Targeted body oil or serum on concern areas (dark marks, uneven tone)',
      'Rich body butter all over — focus on elbows, knees, and dry patches',
    ],
    products: [
      'CeraVe SA Body Wash (gentle daily exfoliation with salicylic acid)',
      'Gold Bond Healing Skin Therapy Lotion',
      'Palmer\'s Firming Butter or Cocoa Butter',
      'The Inkey List Tranexamic Acid Body Serum (for dark marks)',
    ],
    notes: [
      'Apply body moisturiser within 2 minutes of showering — this makes a dramatic difference.',
      'Limit exfoliation to 2–3x per week — over-exfoliating causes irritation and rebound sensitivity.',
      'Neck, chest, and hands age fastest — these areas need SPF every day.',
    ],
  },

  // ── BRIGHTENING / GLOW ───────────────────────────────────────────────────────

  brightening: {
    diagnosis: 'Skin lacking radiance and glow — a targeted brightening routine with consistent exfoliation and antioxidant protection will deliver visible results in 4–6 weeks.',
    morning: [
      'Gentle brightening cleanser or low-pH cleanser',
      'Vitamin C 10–15% serum — brightens + protects from UV damage',
      'Lightweight radiance moisturiser',
      'SPF 50+ (locks in all your brightening work)',
    ],
    night: [
      'Double cleanse',
      'AHA exfoliant 2–3x/week (glycolic or lactic acid)',
      'Niacinamide 10% serum on non-exfoliant nights',
      'Hydrating night cream',
    ],
    products: [
      'TruSkin Vitamin C Serum (value pick)',
      'The Ordinary Lactic Acid 10% + HA (gentle AHA)',
      'Kiehl\'s Ultra Facial Cream or CeraVe Moisturising Cream',
    ],
    notes: [
      'Glow comes from the combination of hydration + gentle exfoliation + vitamin C — not one product alone.',
      'AHA at night + vitamin C in morning = the most effective brightening stack.',
      'SPF without fail every morning — UV is the biggest cause of dull, uneven skin.',
    ],
  },

  // ── GENERAL ──────────────────────────────────────────────────────────────────

  general: {
    diagnosis: 'General skin health and maintenance — a clean, consistent foundational routine is the single most impactful thing you can do for your skin.',
    morning: [
      'Gentle cleanser matched to your skin type',
      'Antioxidant serum (vitamin C or niacinamide)',
      'Moisturiser',
      'SPF 30+ — every single day, rain or shine',
    ],
    night: [
      'Gentle cleanser',
      'Treatment serum (retinol or niacinamide — start low, go slow)',
      'Moisturiser',
    ],
    products: [
      'CeraVe or Cetaphil cleanser (pharmacy classics for a reason)',
      'The Ordinary Niacinamide 10% + Zinc',
      'SPF of your choice — the best SPF is the one you\'ll actually wear daily',
    ],
    notes: [
      'Consistency beats complexity — a simple routine done every day beats an elaborate one done occasionally.',
      'SPF is the highest-impact anti-ageing and skin-health step in existence.',
      'Add one new product every 2 weeks so you can identify what works (or doesn\'t).',
    ],
  },
}

// ── Key resolver ──────────────────────────────────────────────────────────────

/**
 * Picks the best template key for a given concern + skin type combination.
 * Falls back gracefully to the base concern key, then 'general'.
 */
function resolveKey(concern, skinType, sensitive) {
  // Sensitivity override for acne
  if (concern === 'acne' && sensitive) return 'acne_sensitive'
  // Skin-type-specific acne variants
  if (concern === 'acne') {
    const candidate = `acne_${skinType}`
    if (TEMPLATES[candidate]) return candidate
    return 'acne_oily' // default acne fallback
  }
  // All other conditions have a single template
  return TEMPLATES[concern] ? concern : 'general'
}

// ── Budget modifiers ──────────────────────────────────────────────────────────

function applyBudgetNotes(notes, budget) {
  const out = [...notes]
  if (budget === 'budget') {
    out.push('Budget tip: CeraVe, The Ordinary, and Neutrogena are clinical-grade and affordable — you do not need luxury brands to get results.')
  } else if (budget === 'premium') {
    out.push('Premium recommendation: consider adding a monthly professional peel or enzyme mask to accelerate your results at home.')
  }
  return out
}

// ── Severity modifier ─────────────────────────────────────────────────────────

function applySeverityNote(notes, severityRaw = '') {
  const out = [...notes]
  if (/severe|very bad|really bad|extreme|unbearable/.test((severityRaw).toLowerCase())) {
    out.push('Given the severity, consider a dermatologist consultation alongside your home routine — prescription treatments (tretinoin, clindamycin, azelaic acid Rx) can accelerate results significantly.')
  }
  return out
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyzes a lead's intake data and produces a clinical skincare diagnosis.
 *
 * Pure function — no DB access. Call it with the full lead record (or a
 * merged object of lead + just-captured updateData) right when intake_complete
 * is reached.
 *
 * @param {object} leadData  Any subset of Lead fields
 * @returns {{ diagnosis: string, routine: {morning:string[], night:string[]}, productRecommendations: string[], notes: string[] }}
 */
function analyzeLead(leadData) {
  const {
    telegramConcern,
    telegramSkinType,
    telegramSensitivity,
    telegramBudget,
    telegramSeverity,
    telegramRoutineGoal,
    telegramProductsUsed,
    skinConcern,
    intent,
  } = leadData

  // Determine primary skin type
  const skinType = normalizeSkinType(telegramSkinType || '')

  // Determine sensitivity
  const sensitive = isSensitive(telegramSensitivity || '', telegramSkinType || '')

  // Resolve concern from all available signals (prefer Telegram intake data)
  const rawConcern = telegramConcern || telegramRoutineGoal || skinConcern || intent || ''
  const concern = normalizeConcern(rawConcern)

  // Budget
  const budget = getBudget(telegramBudget || '')

  // Resolve template
  const key = resolveKey(concern, skinType, sensitive)
  const tpl = TEMPLATES[key] || TEMPLATES.general

  // Build notes with modifiers
  let notes = applySeverityNote(tpl.notes, telegramSeverity || '')
  notes = applyBudgetNotes(notes, budget)

  // If skin is sensitive AND the key doesn't already say sensitive, add a caution
  if (sensitive && !key.includes('sensitive')) {
    notes.push('Note: your skin is reactive — introduce each new product slowly and patch test first.')
  }

  return {
    diagnosis: tpl.diagnosis,
    routine: {
      morning: tpl.morning,
      night: tpl.night,
    },
    productRecommendations: tpl.products,
    notes,
  }
}

module.exports = { analyzeLead }
