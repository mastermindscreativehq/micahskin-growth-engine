'use strict'

function safeRequire(path) {
  try {
    return require(path)
  } catch (err) {
    console.warn(`[mce/index] failed to load ${path}: ${err.message}`)
    return null
  }
}

module.exports = {
  leadTimelineService:      safeRequire('./leadTimelineService'),
  objectionDetector:        safeRequire('./objectionDetector'),
  resellerIntentService:    safeRequire('./resellerIntentService'),
  conversationRouter:       safeRequire('./conversationRouter'),
  whatsappBridgeService:    safeRequire('./whatsappBridgeService'),
  nigerianCopyLocalizer:    safeRequire('./nigerianCopyLocalizer'),
  mceFollowUpService:       safeRequire('./mceFollowUpService'),
  funnelAttributionService: safeRequire('./funnelAttributionService'),
}
