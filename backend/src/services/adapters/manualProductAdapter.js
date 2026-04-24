'use strict'

/**
 * Manual product adapter.
 * Wraps a plain array of raw products for use with runIngestion().
 *
 * Usage:
 *   const adapter = createManualAdapter(products)
 *   await runIngestion(adapter)
 */
function createManualAdapter(products) {
  return {
    name:        'manual_import',
    sourceStore: 'manual',
    fetch:       async () => (Array.isArray(products) ? products : []),
  }
}

module.exports = { createManualAdapter }
