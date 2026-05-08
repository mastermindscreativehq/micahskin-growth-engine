'use strict'

/**
 * leadPsychologyService.js
 * Phase 33 — MAIE
 *
 * Deterministic psychological scoring of comments / captions / bios.
 * Pure function — no I/O, no AI, fully testable.
 *
 *   analyze(text, opts?)  →  {
 *     painScore          : 0..100
 *     urgencyScore       : 0..100
 *     buyerIntentScore   : 0..100
 *     emotionalIntensity : 0..100
 *     authenticityScore  : 0..100        // inverse of spam/bot signals
 *     painSignals        : string[]
 *     buyerSignals       : string[]
 *     emotionalSignals   : string[]
 *     urgencySignals     : string[]
 *   }
 */

// ── Lexicons (each entry: { tag, weight, pattern }) ───────────────────────────

const PAIN_LEXICON = [
  { tag: 'tried_everything',    weight: 26, pattern: /\b(i'?ve|i\s+have)\s+tried\s+everything\b/i },
  { tag: 'nothing_works',       weight: 26, pattern: /\bnothing\s+(is\s+)?work(s|ing)?\b/i },
  { tag: 'tired',               weight: 18, pattern: /\b(i'?m|i\s+am)\s+(so\s+)?tired\s+(of\s+)?(this|it|my)?\b/i },
  { tag: 'skin_ruined',         weight: 24, pattern: /\b(skin|face)\s+(is\s+)?(ruined|destroyed|spoilt|spoiled|gone|done|terrible|awful|horrible)\b/i },
  { tag: 'embarrassed',         weight: 20, pattern: /\b(embarrass(ed|ing)|ashamed|insecure|self[-\s]?conscious)\b/i },
  { tag: 'hate_my_skin',        weight: 22, pattern: /\b(hate|dislike|can'?t\s+stand)\s+my\s+(skin|face|body|knuckle|spots?)\b/i },
  { tag: 'struggling',          weight: 16, pattern: /\bstruggl(e|ing)\s+(with|since|for)\b/i },
  { tag: 'been_dealing',        weight: 16, pattern: /\bbeen\s+dealing\s+with\s+(this|it)\b/i },
  { tag: 'years_of',            weight: 18, pattern: /\b(\d+|few|several|many)\s+(year|month)s?\s+(now|of\s+(this|struggling))\b/i },
  { tag: 'cried',               weight: 18, pattern: /\b(i\s+)?(cried|cry|crying)\s+(every|so|too|because|over)\b/i },
  { tag: 'frustrated',          weight: 14, pattern: /\b(so\s+)?frustrat(ed|ing)\b/i },
  { tag: 'desperate',           weight: 22, pattern: /\b(desperate|hopeless|helpless|at\s+my\s+wit'?s\s+end)\b/i },
  { tag: 'help_me',             weight: 14, pattern: /\b(help\s+me|i\s+need\s+help|please\s+help|pls\s+help)\b/i },
  { tag: 'please_help',         weight: 12, pattern: /\babeg\b/i },                    // pidgin "abeg" = please
  { tag: 'so_done',             weight: 14, pattern: /\bso\s+done\s+with\s+(this|it|my)\b/i },
  { tag: 'lost_confidence',     weight: 16, pattern: /\blost\s+(my\s+)?(confidence|self[-\s]?esteem)\b/i },
  { tag: 'will_pay_anything',   weight: 22, pattern: /\b(i\s+will|i'?ll|i'?d)\s+pay\s+(any|whatever|anything)\b/i },
  { tag: 'this_is_me',          weight: 12, pattern: /\bthis\s+is\s+me\b/i },
  { tag: 'same_problem',        weight: 12, pattern: /\bsame\s+(problem|issue|struggle|thing)\b/i },
]

const URGENCY_LEXICON = [
  { tag: 'wedding',             weight: 26, pattern: /\b(my\s+)?wedding\s+(is\s+)?(in|next|on|coming)\b/i },
  { tag: 'event_soon',          weight: 22, pattern: /\b(event|party|birthday|graduation|introduction)\s+(is\s+)?(in|next|on|coming|soon)\b/i },
  { tag: 'next_month',          weight: 18, pattern: /\bnext\s+(month|week)\b/i },
  { tag: 'this_week',           weight: 16, pattern: /\bthis\s+(week|month)\b/i },
  { tag: 'urgent',              weight: 28, pattern: /\b(urgent(ly)?|asap|right\s+now|immediately)\b/i },
  { tag: 'need_fast',           weight: 22, pattern: /\bneed\s+(a\s+)?(solution|product|cream|serum|something)\s+(fast|quick(ly)?|now|asap)\b/i },
  { tag: 'before',              weight: 18, pattern: /\bbefore\s+(my|the|next)\s+\w+\b/i },
  { tag: 'days_left',           weight: 18, pattern: /\b\d+\s+(day|week)s?\s+(left|to\s+go|away)\b/i },
  { tag: 'starting_school',     weight: 16, pattern: /\b(school|nysc|youth\s*service|university|uni)\s+(resumes|starts|begins)\b/i },
]

const BUYER_LEXICON = [
  { tag: 'where_to_buy',        weight: 30, pattern: /\bwhere\s+(can|do|to)\s+(i|you)\s+(buy|get|order)\b/i },
  { tag: 'price',               weight: 28, pattern: /\b(how\s+much|price|cost|pricing|how\s+much\s+is\s+this)\??/i },
  { tag: 'link_please',         weight: 28, pattern: /\b(link\s+(please|pls|biko)|drop\s+(the\s+)?link|share\s+(the\s+)?link|send\s+(me\s+)?(the\s+)?link)\b/i },
  { tag: 'who_sells',           weight: 26, pattern: /\bwho\s+(sells|sell|sabi|knows?\s+where)\b/i },
  { tag: 'order_now',           weight: 24, pattern: /\b(i\s+want|i'?d\s+like|i\s+would\s+like|i\s+wan)\s+(to\s+)?(buy|order|get|purchase)\b/i },
  { tag: 'dm_me',               weight: 22, pattern: /\b(dm|message|text|whatsapp)\s+me\b/i },
  { tag: 'send_details',        weight: 22, pattern: /\b(send|share|drop)\s+(me\s+)?(the\s+)?(details|info|catalog|menu|price\s*list)\b/i },
  { tag: 'available',           weight: 18, pattern: /\b(is\s+(this|it)\s+available|do\s+you\s+(have|sell|stock))\b/i },
  { tag: 'recommend_me',        weight: 16, pattern: /\b(recommend|suggest)\s+(me\s+)?(a|some|something|product|cream|serum)\b/i },
  { tag: 'best_for',            weight: 14, pattern: /\bbest\s+(product|cream|serum|routine|soap)\s+for\b/i },
  { tag: 'how_to_get',          weight: 18, pattern: /\bhow\s+(do|can|to)\s+(i|you)\s+(get|order|purchase)\b/i },
  // Pidgin / Naija buying signals
  { tag: 'which_cream_pidgin',  weight: 24, pattern: /\bwhich\s+(cream|product|soap|serum)\s+(dey\s+)?work\b/i },
  { tag: 'who_get_solution',    weight: 22, pattern: /\bwho\s+(get|sabi|know)\s+(solution|cream|cure|product)\b/i },
  { tag: 'abeg_help',           weight: 18, pattern: /\babeg\s+(pls\s+)?(help|recommend|share|drop)\b/i },
  { tag: 'biko_send',           weight: 18, pattern: /\bbiko\s+(send|share|drop|help|recommend)\b/i },
  { tag: 'i_wan_buy',           weight: 26, pattern: /\bi\s+wan(t)?\s+(buy|order|use)\b/i },
  // ── Phase 36 — general English buyer/curiosity patterns ─────────────────
  // Mid weights — a single hit puts us into cold (with the buyer-floor rule
  // in leadHeatEngine), and two hits push into warm.
  { tag: 'what_can_i_use',      weight: 30, pattern: /\bwhat\s+(can|should|do|to)\s+(i|we|you)\s+(use|do|try|get)\b/i },
  { tag: 'can_i_use',           weight: 26, pattern: /\bcan\s+(i|we|you)\s+(use|try|do|apply)\b/i },
  { tag: 'how_do_i',            weight: 28, pattern: /\bhow\s+(do|can|to)\s+(i|we|you)\s+(use|treat|fix|remove|get\s+rid|prevent|stop)\b/i },
  { tag: 'does_it_work',        weight: 20, pattern: /\bdoes\s+(it|this|that|.+)\s+(really\s+)?work\b/i },
  { tag: 'any_recommendations', weight: 26, pattern: /\bany\s+(recommendation|suggestion|advice|tip|product|solution)/i },
  { tag: 'works_for',           weight: 24, pattern: /\b(what|which)\s+(works|worked|helps|helped)\s+for\s+(you|your|my|me)\b/i },
  { tag: 'better_for',          weight: 20, pattern: /\b(is|whats|what'?s)\s+(better|good|best|effective)\s+for\b/i },
  { tag: 'should_i_use',        weight: 24, pattern: /\bshould\s+i\s+(use|try|apply|combine)\b/i },
  // Active-ingredient mentions (any one is a strong product-research signal)
  { tag: 'mentions_ingredient', weight: 28, pattern: /\b(niacinamide|azelaic|retinol|tretinoin|hydroquinone|alpha\s*arbutin|hyaluronic|vitamin\s*c|salicylic|mandelic|glycolic|kojic|ceramide|adapalene|benzoyl)\b/i },
  // "What is X" / "what about X" — research questions
  { tag: 'what_is_x',           weight: 24, pattern: /\b(what\s+is|what\s+about|how\s+about)\s+\w/i },
  { tag: 'how_many_times',      weight: 22, pattern: /\bhow\s+(many|often|much)\s+(times|days|weeks)/i },
  // Pain-adjacent product context
  { tag: 'going_broke',         weight: 24, pattern: /\b(going|im|i\s+am)\s+broke\b/i },
  { tag: 'creams_dont_work',    weight: 22, pattern: /\b(cream|product|serum)s?\s+(don'?t|do\s+not|won'?t|dont)\s+work\b/i },
  { tag: 'why_dont',            weight: 18, pattern: /\bwhy\s+(don'?t|doesn'?t|dont)\b/i },
  // "Does X help with Y" — high-quality consult prompt
  { tag: 'help_with',           weight: 20, pattern: /\b(help|good|work)\s+with\s+my\s+(dark|uneven|spots|acne|skin|face|knuckles|underarms|stretch)/i },
  // Concern keyword on its own (curiosity bias)
  { tag: 'concern_keyword',     weight: 14, pattern: /\b(dark\s+spots?|hyperpigmentation|stretch\s*marks?|acne\s+scars?|uneven\s+(tone|skin)|melasma|dark\s+(knuckles?|underarms?|patches?))\b/i },
]

const EMOTION_LEXICON = [
  { tag: 'tears_emoji',         weight: 18, pattern: /😭|😢|🥲|😩|😫/u },
  { tag: 'broken_heart',        weight: 14, pattern: /💔/u },
  { tag: 'pleading_face',       weight: 14, pattern: /🥺/u },
  { tag: 'anger',               weight: 10, pattern: /😡|🤬|😤/u },
  { tag: 'all_caps_phrase',     weight: 10, pattern: /\b[A-Z]{4,}\b/ },
  { tag: 'multiple_exclaim',    weight: 8,  pattern: /!{2,}/ },
  { tag: 'multiple_question',   weight: 8,  pattern: /\?{2,}/ },
  { tag: 'long_complaint',      weight: 8,  pattern: /^.{180,}$/s },
  { tag: 'crying_word',         weight: 14, pattern: /\b(crying|tears|sobbing|in\s+tears)\b/i },
  { tag: 'depressed',           weight: 16, pattern: /\b(depress(ed|ing|ion)|miserable|defeated)\b/i },
]

// Authenticity penalties — high count → lower authenticity score.
const SPAM_LEXICON = [
  { tag: 'http_link',           weight: 20, pattern: /\bhttps?:\/\/\S+/i },
  { tag: 'follow_me',           weight: 18, pattern: /\bfollow\s+(me|back|us)\b/i },
  { tag: 'shop_now',            weight: 16, pattern: /\bshop\s+now\b/i },
  { tag: 'buy_now',             weight: 16, pattern: /\bbuy\s+now\b/i },
  { tag: 'promo_code',          weight: 14, pattern: /\bpromo\s+code\b/i },
  { tag: 'pct_off',             weight: 14, pattern: /\b\d{1,3}%\s+off\b/i },
  { tag: 'check_my_profile',    weight: 12, pattern: /\bcheck\s+(my|out\s+my)\s+(profile|page|bio|page)\b/i },
  { tag: 'link_in_bio',         weight: 12, pattern: /\blink\s+in\s+(bio|description)\b/i },
  { tag: 'emoji_dense',         weight: 10, pattern: /(\p{Emoji}\s*){8,}/u },
  { tag: 'hashtag_dense',       weight: 8,  pattern: /(#\w+\s*){6,}/i },
]

// ── Helpers ──────────────────────────────────────────────────────────────────

function _scoreLexicon(text, lex, cap = 100) {
  if (!text) return { score: 0, hits: [] }
  let total = 0
  const hits = []
  for (const entry of lex) {
    if (entry.pattern.test(text)) {
      total += entry.weight
      hits.push(entry.tag)
    }
  }
  return { score: Math.max(0, Math.min(cap, total)), hits }
}

function _round(n) {
  return Math.round(n * 100) / 100
}

// ── Public API ───────────────────────────────────────────────────────────────

function analyze(input, opts = {}) {
  const corpus = Array.isArray(input)
    ? input.filter(Boolean).map(String).join('\n')
    : (input ? String(input) : '')

  if (!corpus.trim()) {
    return {
      painScore:          0,
      urgencyScore:       0,
      buyerIntentScore:   0,
      emotionalIntensity: 0,
      authenticityScore:  100,
      painSignals:        [],
      buyerSignals:       [],
      emotionalSignals:   [],
      urgencySignals:     [],
    }
  }

  const pain    = _scoreLexicon(corpus, PAIN_LEXICON)
  const urgency = _scoreLexicon(corpus, URGENCY_LEXICON)
  const buyer   = _scoreLexicon(corpus, BUYER_LEXICON)
  const emotion = _scoreLexicon(corpus, EMOTION_LEXICON)
  const spam    = _scoreLexicon(corpus, SPAM_LEXICON)

  // authenticityScore = 100 minus spam pressure, floored at 0
  const authenticityScore = Math.max(0, Math.min(100, 100 - spam.score))

  return {
    painScore:          _round(pain.score),
    urgencyScore:       _round(urgency.score),
    buyerIntentScore:   _round(buyer.score),
    emotionalIntensity: _round(emotion.score),
    authenticityScore:  _round(authenticityScore),
    painSignals:        pain.hits,
    buyerSignals:       buyer.hits,
    emotionalSignals:   emotion.hits,
    urgencySignals:     urgency.hits,
  }
}

module.exports = { analyze }
