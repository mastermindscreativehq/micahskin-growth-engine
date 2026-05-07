'use strict'

/**
 * painSignalClassifierService.js
 * Phase 35 — MICAHSKIN Pain Signal Classifier
 *
 * Deterministic, regex-driven classifier that turns a TikTok comment / caption
 * into structured emotional + buying signals. Pure function — no I/O, no AI,
 * fully testable.
 *
 *   classify(text, opts?)  →  {
 *     painSignalScore       : 0..100
 *     emotionalPainLevel    : 0..100
 *     problemAwarenessLevel : 'unaware' | 'problem_aware' | 'solution_aware'
 *                            | 'product_aware' | 'most_aware'
 *     matchedPainSignals    : Array<{ tag, phrase, weight }>
 *     painPhrases           : string[]   // canonical phrases (for dashboards)
 *     painTags              : string[]   // raw tags (for stats)
 *     lowQualitySignals     : string[]   // tags only — feeds the lead-quality gate
 *     lowQualityScore       : 0..100     // higher = more spammy
 *     isLikelySpam          : boolean
 *   }
 */

const {
  PAIN_SIGNALS,
  PROBLEM_SIGNALS,
  DESIRE_SIGNALS,
  HISTORY_SIGNALS,
  LOW_QUALITY_SIGNALS,
} = require('../config/painSignals')

// Internal: run a lexicon over text, return raw hits + capped sum.
function _runLexicon(text, lex, cap = 100) {
  const hits = []
  let total = 0
  for (const entry of lex) {
    if (entry.pattern.test(text)) {
      total += entry.weight
      hits.push({ tag: entry.tag, phrase: entry.phrase, weight: entry.weight })
    }
  }
  return { score: Math.max(0, Math.min(cap, total)), hits }
}

function _round(n) { return Math.round(n * 100) / 100 }

/**
 * Pure classifier — no DB, no logging.
 *
 * @param {string|string[]} input    text or list of texts (joined with newline)
 * @returns {object} structured pain-signal payload (see header)
 */
function classify(input) {
  const corpus = Array.isArray(input)
    ? input.filter(Boolean).map(String).join('\n')
    : (input ? String(input) : '')

  if (!corpus.trim()) {
    return {
      painSignalScore:       0,
      emotionalPainLevel:    0,
      problemAwarenessLevel: 'unaware',
      matchedPainSignals:    [],
      painPhrases:           [],
      painTags:              [],
      lowQualitySignals:     [],
      lowQualityScore:       0,
      isLikelySpam:          false,
    }
  }

  // Pain — emotional desperation, "tried everything" energy
  const pain     = _runLexicon(corpus, PAIN_SIGNALS)
  // Problem-aware — they can name the concern
  const problem  = _runLexicon(corpus, PROBLEM_SIGNALS)
  // Desire — aspirational ("how did you get your skin like this")
  const desire   = _runLexicon(corpus, DESIRE_SIGNALS)
  // History of failure — burned, fake products, looking for new
  const history  = _runLexicon(corpus, HISTORY_SIGNALS)
  // Low-quality — emoji-only, spam, brand promo
  const spam     = _runLexicon(corpus, LOW_QUALITY_SIGNALS)

  // ── painSignalScore ────────────────────────────────────────────────────────
  // Drives "is this someone with a real concern". History adds pressure
  // (they've been burned before), problem-naming proves awareness. Capped 0..100.
  const rawPainScore =
    pain.score +
    problem.score * 0.6 +
    history.score * 0.5 +
    desire.score  * 0.25
  const painSignalScore = _round(Math.max(0, Math.min(100, rawPainScore)))

  // ── emotionalPainLevel ─────────────────────────────────────────────────────
  // Pure emotional gravity — pain + history (no problem-naming, no desire).
  // Captures "how much does this hurt right now". Capped 0..100.
  const rawEmo = pain.score + history.score * 0.4
  const emotionalPainLevel = _round(Math.max(0, Math.min(100, rawEmo)))

  // ── problemAwarenessLevel ──────────────────────────────────────────────────
  // Coarse stage label — refined further in buyerReadinessService where we
  // also have buyer-signal scores. This is the "without buyer signal" view.
  let problemAwarenessLevel = 'unaware'
  if (problem.hits.length === 0 && pain.hits.length === 0) {
    problemAwarenessLevel = 'unaware'
  } else if (problem.hits.length > 0 && desire.hits.length === 0) {
    problemAwarenessLevel = 'problem_aware'
  } else if (desire.hits.length > 0) {
    problemAwarenessLevel = 'solution_aware'
  }

  // ── Aggregations ───────────────────────────────────────────────────────────
  const matched = [...pain.hits, ...problem.hits, ...desire.hits, ...history.hits]
  const painTags    = matched.map(h => h.tag)
  const painPhrases = matched.map(h => h.phrase)

  // ── Spam / low-quality ─────────────────────────────────────────────────────
  // Two layers: explicit hits in the lexicon, AND a heuristic for "this entire
  // comment is just emojis/punctuation". The heuristic catches the long tail
  // of comments that are technically not in the lexicon but obviously useless.
  const trimmed = corpus.trim()
  const lowQualityTags = spam.hits.map(h => h.tag)

  // Heuristic — if there are <2 letter-words, the comment carries no signal.
  const letterWords = (trimmed.match(/[A-Za-z]{2,}/g) || []).length
  if (letterWords < 2 && trimmed.length > 0) {
    if (!lowQualityTags.includes('emoji_only') && !lowQualityTags.includes('too_short')) {
      lowQualityTags.push('low_signal')
    }
  }

  const lowQualityScore = _round(Math.max(0, Math.min(100, spam.score + (letterWords < 2 ? 30 : 0))))
  const isLikelySpam = lowQualityScore >= 40

  return {
    painSignalScore,
    emotionalPainLevel,
    problemAwarenessLevel,
    matchedPainSignals: matched,
    painPhrases,
    painTags,
    lowQualitySignals:  lowQualityTags,
    lowQualityScore,
    isLikelySpam,
  }
}

module.exports = { classify }
