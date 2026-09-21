'use strict'

// Personalized Skin Assessment fee — a standalone commercial transaction.
// This has NO relationship to product pricing/credit/discount. Do not derive
// bundle/product pricing from this value or vice versa.
const ASSESSMENT_FEE_NGN = parseInt(process.env.ASSESSMENT_FEE_NGN, 10) || 10000
const ASSESSMENT_FEE_KOBO = ASSESSMENT_FEE_NGN * 100
const ASSESSMENT_PAYMENT_TYPE = 'skin_assessment'
const ASSESSMENT_CURRENCY = 'NGN'

module.exports = {
  ASSESSMENT_FEE_NGN,
  ASSESSMENT_FEE_KOBO,
  ASSESSMENT_PAYMENT_TYPE,
  ASSESSMENT_CURRENCY,
}
