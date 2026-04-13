/**
 * dedupeService.js
 * Prevents the same social post from being stored or scored more than once.
 *
 * Deduplication key: RawSocialItem.externalId (platform-assigned post/item ID).
 * The Prisma schema enforces a @unique constraint on this column, so even if
 * two concurrent import jobs race, only one will succeed at the DB level.
 */

const prisma = require('../lib/prisma')

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether a social item with the given external ID already exists.
 *
 * @param {string} externalId  Platform-assigned post ID.
 * @returns {Promise<boolean>}  true = already stored, skip this item.
 */
async function isDuplicate(externalId) {
  const existing = await prisma.rawSocialItem.findUnique({
    where: { externalId },
    select: { id: true },
  })
  return existing !== null
}

/**
 * Batch duplicate check — returns a Set of externalIds that are already stored.
 * More efficient than calling isDuplicate() in a loop when pre-filtering a large
 * batch before the main processing loop.
 *
 * @param {string[]} externalIds
 * @returns {Promise<Set<string>>}
 */
async function findExistingIds(externalIds) {
  if (externalIds.length === 0) return new Set()

  const rows = await prisma.rawSocialItem.findMany({
    where: { externalId: { in: externalIds } },
    select: { externalId: true },
  })

  return new Set(rows.map(r => r.externalId))
}

module.exports = { isDuplicate, findExistingIds }
