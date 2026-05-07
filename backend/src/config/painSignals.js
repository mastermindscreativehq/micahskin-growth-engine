'use strict'

/**
 * painSignals.js
 * Phase 35 — MICAHSKIN Pain Signal Classifier
 *
 * Deterministic lexicons used by painSignalClassifierService and
 * buyerReadinessService. Pure data — no I/O, no side effects.
 *
 * Each lexicon entry:
 *   { tag, weight, pattern, phrase }
 *
 *   tag      — short stable identifier (used in stats + DB JSON columns)
 *   weight   — additive contribution toward its category score (0..100 cap)
 *   pattern  — RegExp matched against lower-case-friendly text
 *   phrase   — human-readable canonical phrase (used in dashboard breakdowns)
 */

// ── HIGH PAIN — emotional desperation, "I've tried everything" energy ────────
//
// These signal that the writer has lived with a problem long enough that the
// emotional weight is doing the talking. Highest leverage for empathy-led
// outreach.

const PAIN_SIGNALS = [
  { tag: 'tried_everything',   weight: 28, phrase: "I've tried everything",
    pattern: /\b(i'?ve|i\s+have)\s+tried\s+everything\b/i },
  { tag: 'nothing_works',      weight: 28, phrase: 'nothing works',
    pattern: /\bnothing\s+(is\s+)?work(s|ing|ed)?\b/i },
  { tag: 'nothing_worked_for_me', weight: 26, phrase: 'nothing has worked for me',
    pattern: /\bnothing\s+has\s+worked\s+for\s+me\b/i },
  { tag: 'i_am_tired',         weight: 22, phrase: "I'm tired of this",
    pattern: /\b(i'?m|i\s+am)\s+(so\s+)?tired\s+(of|with)?\b/i },
  { tag: 'i_give_up',          weight: 22, phrase: 'I give up',
    pattern: /\bi\s+(just\s+)?(give|gave)\s+up\b/i },
  { tag: 'hate_my_skin',       weight: 24, phrase: 'I hate my skin',
    pattern: /\b(hate|dislike|can'?t\s+stand)\s+my\s+(skin|face|body|knuckles?|spots?|complexion)\b/i },
  { tag: 'frustrated',         weight: 18, phrase: "I'm so frustrated",
    pattern: /\b(i'?m|i\s+am)\s+(so\s+)?frustrat(ed|ing)\b/i },
  { tag: 'why_is_my_skin',     weight: 20, phrase: 'why is my skin like this',
    pattern: /\bwhy\s+is\s+my\s+(skin|face)\s+(like\s+)?(this|so)\b/i },
  { tag: 'struggling_with',    weight: 18, phrase: "I've been struggling with",
    pattern: /\bbeen\s+strugg(le|ling)\s+with\b/i },
  { tag: 'years_of',           weight: 22, phrase: 'been dealing with this for years',
    pattern: /\b(been\s+dealing|dealing|struggling)\s+with\s+(this|it)\s+for\s+(\d+\s+)?(year|month)s?\b/i },
  { tag: 'please_help',        weight: 18, phrase: 'please help',
    pattern: /\b(please|pls|plz|abeg|biko)\s+help\b/i },
  { tag: 'help_me',            weight: 14, phrase: 'help me',
    pattern: /\bhelp\s+me\b/i },
  { tag: 'desperate',          weight: 22, phrase: 'desperate',
    pattern: /\b(desperate|hopeless|helpless|at\s+my\s+wit'?s\s+end)\b/i },
  { tag: 'embarrassed',        weight: 20, phrase: 'so embarrassing',
    pattern: /\b(embarrass(ed|ing)|ashamed|insecure|self[-\s]?conscious)\b/i },
  { tag: 'crying',             weight: 18, phrase: "I've been crying",
    pattern: /\b(crying|cry|cried|in\s+tears|sobbing)\b/i },
  { tag: 'depressed',          weight: 18, phrase: 'depressed about my skin',
    pattern: /\b(depress(ed|ing|ion)|miserable|defeated)\b/i },
]

// ── HIGH BUYER INTENT — pricing, ordering, location/availability questions ───
//
// These are explicit shopping signals — the writer has effectively raised
// their hand. Weighted heavier than pain because they collapse the funnel
// straight to a quote / purchase moment.

const BUYER_SIGNALS = [
  // Pricing
  { tag: 'how_much',           weight: 32, phrase: 'how much',
    pattern: /\bhow\s+much\b/i },
  { tag: 'whats_the_price',    weight: 30, phrase: "what's the price",
    pattern: /\b(what'?s|what\s+is)\s+(the\s+)?(price|cost|pricing)\b/i },
  { tag: 'price_question',     weight: 24, phrase: 'price?',
    pattern: /\b(price|cost|pricing)\s*\??$/im },

  // Where to buy / shipping
  { tag: 'where_can_i_buy',    weight: 32, phrase: 'where can I buy',
    pattern: /\bwhere\s+(can|do|to)\s+(i|you)\s+(buy|get|order|find)\b/i },
  { tag: 'how_do_i_order',     weight: 30, phrase: 'how do I order',
    pattern: /\bhow\s+(do|can|to)\s+(i|you)?\s*(order|purchase|buy|get)\b/i },
  { tag: 'do_you_ship_ng',     weight: 30, phrase: 'do you ship to Nigeria',
    pattern: /\bdo\s+you\s+ship\s+(to\s+)?(nigeria|naija|lagos|abuja)\b/i },
  { tag: 'available_in_ng',    weight: 30, phrase: 'can I get it in Nigeria',
    pattern: /\b(can\s+(i|we)\s+(get|find|buy|order)|(is\s+(it|this)\s+available))\s+(it\s+)?in\s+(nigeria|naija|lagos|abuja|port\s+harcourt|ph)\b/i },
  { tag: 'where_in_lagos',     weight: 26, phrase: 'where to get it in Lagos',
    pattern: /\bwhere\s+(to\s+)?(get|buy|find|order)\s+.*\b(lagos|abuja|naija|nigeria)\b/i },
  { tag: 'available_question', weight: 18, phrase: 'is it available?',
    pattern: /\bis\s+(it|this)\s+available\b/i },

  // Link / DM
  { tag: 'link_please',        weight: 28, phrase: 'link please',
    pattern: /\b(link\s+(please|pls|biko|abeg)|drop\s+(the\s+)?link|share\s+(the\s+)?link|send\s+(me\s+)?(the\s+)?link)\b/i },
  { tag: 'send_me_link',       weight: 26, phrase: 'send me the link',
    pattern: /\b(send|drop)\s+me\s+(the\s+)?link\b/i },
  { tag: 'dm_me_details',      weight: 24, phrase: 'DM me the details',
    pattern: /\b(dm|message|text|whatsapp|wa)\s+me\b/i },
  { tag: 'send_details',       weight: 22, phrase: 'send me the details',
    pattern: /\b(send|share|drop)\s+(me\s+)?(the\s+)?(details|info|catalog|menu|price\s*list)\b/i },

  // Want / need
  { tag: 'i_need_this',        weight: 28, phrase: 'I need this',
    pattern: /\bi\s+need\s+(this|that|it|something|a\s+product)\b/i },
  { tag: 'i_want_this',        weight: 26, phrase: 'I want this',
    pattern: /\b(i\s+want|i'?d\s+like|i\s+wan(t)?)\s+(this|that|it|to\s+(buy|order|get|use|try))\b/i },
  { tag: 'taking_my_money',    weight: 30, phrase: 'taking my money',
    pattern: /\b(shut\s+up\s+and\s+)?take\s+my\s+money\b/i },

  // What did you use / what should I use
  { tag: 'what_did_you_use',   weight: 30, phrase: 'what did you use',
    pattern: /\bwhat\s+(did|do)\s+you\s+use\b/i },
  { tag: 'what_should_i_use',  weight: 26, phrase: 'what should I use',
    pattern: /\bwhat\s+should\s+i\s+(use|do|try|buy|get)\b/i },
  { tag: 'recommend_something',weight: 26, phrase: 'recommend something',
    pattern: /\b(recommend|suggest)\s+(me\s+)?(a|some|something|product|cream|serum)\b/i },
  { tag: 'what_recommend',     weight: 24, phrase: 'what do you recommend',
    pattern: /\bwhat\s+(do|would)\s+you\s+recommend\b/i },
  { tag: 'best_for',           weight: 18, phrase: 'best product for',
    pattern: /\bbest\s+(product|cream|serum|routine|soap)\s+for\b/i },
  { tag: 'what_works_for',     weight: 18, phrase: 'what works for',
    pattern: /\bwhat\s+(works|worked)\s+for\b/i },
  { tag: 'has_anyone_tried',   weight: 14, phrase: 'has anyone tried',
    pattern: /\bhas\s+anyone\s+(tried|used)\b/i },
  { tag: 'anyone_suggest',     weight: 16, phrase: 'can anyone suggest',
    pattern: /\bcan\s+anyone\s+(suggest|recommend|help)\b/i },
  { tag: 'which_is_better',    weight: 14, phrase: 'which one is better',
    pattern: /\bwhich\s+(one\s+)?is\s+better\b/i },
  { tag: 'does_anyone_know',   weight: 14, phrase: 'does anyone know a good',
    pattern: /\bdoes\s+anyone\s+know\s+(a\s+)?good\b/i },
  { tag: 'what_cream_works',   weight: 18, phrase: 'what cream works for',
    pattern: /\bwhat\s+(cream|product|soap|serum|routine)\s+(works|worked|is\s+good)\s+for\b/i },
  { tag: 'does_it_work',       weight: 16, phrase: 'does this really work',
    pattern: /\bdoes\s+(this|it|that)\s+(really|actually)?\s*work\b/i },
]

// ── PROBLEM-AWARE — they can name their concern, even without buyer intent ───
//
// Naming the concern is the gateway from "unaware" → "problem-aware". These
// boost painAware and feed the diagnosis engine even when no buyer signal
// fires.

const PROBLEM_SIGNALS = [
  { tag: 'dark_knuckles',      weight: 22, phrase: 'dark knuckles',
    pattern: /\bdark(en(ed|ing)?)?\s+knuckles?\b/i },
  { tag: 'dark_underarms',     weight: 22, phrase: 'dark underarms',
    pattern: /\bdark\s+(underarms?|armpits?)\b/i },
  { tag: 'dark_inner_thighs',  weight: 22, phrase: 'dark inner thighs',
    pattern: /\bdark\s+(inner\s+)?thighs?\b/i },
  { tag: 'dark_spots',         weight: 22, phrase: 'dark spots',
    pattern: /\bdark\s+spots?\b/i },
  { tag: 'acne_scars',         weight: 22, phrase: 'acne scars',
    pattern: /\bacne\s+(scars?|marks?)\b/i },
  { tag: 'hyperpigmentation',  weight: 24, phrase: 'hyperpigmentation',
    pattern: /\bhyper[-\s]?pigmentation\b/i },
  { tag: 'pih',                weight: 22, phrase: 'PIH',
    pattern: /\b(p\s*i\s*h|post[-\s]?inflammatory(\s+hyperpigmentation)?)\b/i },
  { tag: 'stretch_marks',      weight: 22, phrase: 'stretch marks',
    pattern: /\bstretch[-\s]?marks?|striae|pregnancy\s+marks?\b/i },
  { tag: 'uneven_skin_tone',   weight: 20, phrase: 'uneven skin tone',
    pattern: /\buneven\s+(skin\s+)?tone\b/i },
  { tag: 'discoloration',      weight: 18, phrase: 'discoloration',
    pattern: /\bdiscolou?ration\b/i },
  { tag: 'melasma',            weight: 22, phrase: 'melasma',
    pattern: /\bmelasma\b/i },
  { tag: 'blackheads',         weight: 16, phrase: 'blackheads',
    pattern: /\bblackheads?\b/i },
  { tag: 'whiteheads',         weight: 16, phrase: 'whiteheads',
    pattern: /\bwhiteheads?\b/i },
  { tag: 'clogged_pores',      weight: 16, phrase: 'clogged pores',
    pattern: /\bclogged\s+pores?\b/i },
  { tag: 'oily_skin',          weight: 14, phrase: 'oily skin',
    pattern: /\b(oily\s+(skin|face)|excess\s+oil|sebum|greasy\s+(skin|face))\b/i },
  { tag: 'dry_skin',           weight: 14, phrase: 'dry skin',
    pattern: /\bdry\s+(skin|face)\b/i },
  { tag: 'dull_skin',          weight: 14, phrase: 'dull skin',
    pattern: /\bdull\s+(skin|face|complexion)\b/i },
  { tag: 'patchy_skin',        weight: 16, phrase: 'patchy skin',
    pattern: /\bpatchy\s+(skin|face)\b/i },
  { tag: 'rough_skin',         weight: 14, phrase: 'rough skin',
    pattern: /\brough\s+(skin|face)\b/i },
  { tag: 'bumpy_skin',         weight: 14, phrase: 'bumpy skin',
    pattern: /\bbumpy\s+(skin|face)\b/i },
  { tag: 'textured_skin',      weight: 14, phrase: 'textured skin',
    pattern: /\btextured?\s+(skin|face)\b/i },
  { tag: 'not_glowing',        weight: 14, phrase: 'skin not glowing',
    pattern: /\bskin\s+(is\s+)?not\s+glow(ing)?\b/i },
  { tag: 'ashy_skin',          weight: 14, phrase: 'ashy skin',
    pattern: /\bashy\s+(skin|legs|face|body)\b/i },
  { tag: 'body_odor',          weight: 12, phrase: 'body odor',
    pattern: /\bbody\s+odou?r\b/i },
  { tag: 'ingrown_hairs',      weight: 12, phrase: 'ingrown hairs',
    pattern: /\bingrown\s+(hairs?|ones?)\b/i },
  { tag: 'razor_bumps',        weight: 12, phrase: 'razor bumps',
    pattern: /\brazor\s+bumps?\b/i },
  { tag: 'acne_general',       weight: 14, phrase: 'acne',
    pattern: /\b(acne|pimples?|breakouts?|cystic|blemishes?|zits?)\b/i },
]

// ── DESIRE / TRANSFORMATION — aspirational tone, "I want a glow up" ─────────
//
// The writer is in solution-aware territory: they know the result they want
// and are scanning the comments for who delivers it.

const DESIRE_SIGNALS = [
  { tag: 'glow_up',            weight: 18, phrase: 'glow up',
    pattern: /\bglow[-\s]?up\b/i },
  { tag: 'want_glowing_skin',  weight: 18, phrase: 'I want glowing skin',
    pattern: /\b(want|need)\s+(glowing|clear|even|flawless|smooth)\s+(skin|face|complexion)\b/i },
  { tag: 'even_skin_tone',     weight: 16, phrase: 'even skin tone',
    pattern: /\beven\s+(skin\s+)?tone\b/i },
  { tag: 'how_did_you',        weight: 22, phrase: 'how did you get your skin like that',
    pattern: /\bhow\s+did\s+you\s+(get|achieve|make)\s+(your\s+)?(skin|face|complexion)\b/i },
  { tag: 'transformation',     weight: 18, phrase: 'skin transformation',
    pattern: /\bskin\s+transformation\b/i },
  { tag: 'before_and_after',   weight: 16, phrase: 'before and after',
    pattern: /\bbefore\s*(\&|and)\s*after\b/i },
  { tag: 'whats_your_routine', weight: 22, phrase: "what's your skincare routine",
    pattern: /\b(what'?s|what\s+is)\s+(your|the)\s+(skin\s*care\s+)?routine\b/i },
  { tag: 'whats_in_routine',   weight: 18, phrase: "what's in your routine",
    pattern: /\b(what'?s|what\s+is)\s+in\s+your\s+routine\b/i },
  { tag: 'how_long',           weight: 14, phrase: 'how long did it take',
    pattern: /\bhow\s+long\s+did\s+(it|that|this)\s+take\b/i },
  { tag: 'real_results',       weight: 16, phrase: 'real results',
    pattern: /\b(real|actual|true|genuine)\s+results?\b/i },
]

// ── NIGERIA / AFRICAN MARKET CONTEXT — buyer + location combined ─────────────
//
// We already have nigeriaSignalService for full geo confidence; this lexicon
// is narrower and adds a buyer-intent boost when locality is foregrounded
// alongside a request ("price in Lagos?" vs. just "Lagos").

const LOCALITY_SIGNALS = [
  { tag: 'nigeria',            weight: 16, phrase: 'Nigeria',
    pattern: /\bnigeria\b/i },
  { tag: 'naija',              weight: 16, phrase: 'Naija',
    pattern: /\bnaija\b/i },
  { tag: 'lagos',              weight: 14, phrase: 'Lagos',
    pattern: /\blagos\b/i },
  { tag: 'abuja',              weight: 14, phrase: 'Abuja',
    pattern: /\babuja\b/i },
  { tag: 'port_harcourt',      weight: 12, phrase: 'Port Harcourt',
    pattern: /\b(port[-\s]?harcourt|p\.?\s*h\.?|portharcourt)\b/i },
  { tag: 'in_nigeria',         weight: 16, phrase: 'in Nigeria',
    pattern: /\bin\s+nigeria\b/i },
  { tag: 'black_skin',         weight: 16, phrase: 'for black skin',
    pattern: /\bfor\s+(black|melanin|dark|african)\s+skin\b/i },
  { tag: 'our_skin_type',      weight: 14, phrase: 'our skin type',
    pattern: /\b(our|my)\s+(skin\s+)?(type|tone)\b/i },
]

// ── HISTORY OF FAILURE — they've tried and been burned, looking for new ──────
//
// Lower threshold than full pain — these are warm leads who are already
// spending in this category.

const HISTORY_SIGNALS = [
  { tag: 'burned_skin',        weight: 22, phrase: 'burned my skin',
    pattern: /\b(burn(ed|t)|damaged?|ruined?|spoilt|spoiled)\s+my\s+(skin|face)\b/i },
  { tag: 'bad_reaction',       weight: 20, phrase: 'bad reaction',
    pattern: /\b(bad|allergic|terrible)\s+reactions?\b/i },
  { tag: 'fake_product',       weight: 20, phrase: 'fake product',
    pattern: /\bfake\s+(product|cream|serum|stuff)\b/i },
  { tag: 'expired_product',    weight: 18, phrase: 'expired product',
    pattern: /\bexpired\s+(product|cream|serum)\b/i },
  { tag: 'i_stopped_using',    weight: 16, phrase: 'I stopped using',
    pattern: /\bi\s+stopped\s+using\b/i },
  { tag: 'looking_for_better', weight: 18, phrase: 'looking for something better',
    pattern: /\blooking\s+for\s+(something\s+)?(better|new|else|an?\s+alternative)\b/i },
  { tag: 'tired_of_using',     weight: 16, phrase: 'tired of using',
    pattern: /\btired\s+of\s+using\b/i },
  { tag: 'no_results',         weight: 16, phrase: 'not seeing results',
    pattern: /\b(not|no(t)?\s+seeing|haven'?t\s+seen)\s+results?\b/i },
]

// ── LOW QUALITY — emoji-only, generic praise, spam, brand promo ──────────────

const LOW_QUALITY_SIGNALS = [
  { tag: 'emoji_only',         weight: 30, phrase: 'emoji-only',
    pattern: /^[\p{Emoji}\p{Emoji_Presentation}\s\u{200D}\u{FE0F}]{1,16}$/u },
  { tag: 'too_short',          weight: 18, phrase: 'too short',
    pattern: /^.{0,4}$/ },
  { tag: 'generic_praise',     weight: 20, phrase: 'generic praise',
    pattern: /^(beautiful|gorgeous|stunning|nice|cute|love\s+(it|this)|so\s+pretty|wow|omg|amazing|perfect|queen|goddess|❤️*|🔥*)+\.?\s*[!.]*$/i },
  { tag: 'spam_link',          weight: 26, phrase: 'spam link',
    pattern: /\bhttps?:\/\/\S+/i },
  { tag: 'follow_me',          weight: 22, phrase: 'follow me',
    pattern: /\bfollow\s+(me|back|us|for\s+follow)\b/i },
  { tag: 'check_my_profile',   weight: 22, phrase: 'check my profile',
    pattern: /\bcheck\s+(my|out\s+my)\s+(profile|page|bio)\b/i },
  { tag: 'shop_now_promo',     weight: 22, phrase: 'shop now',
    pattern: /\bshop\s+now\b/i },
  { tag: 'buy_now_promo',      weight: 22, phrase: 'buy now',
    pattern: /\bbuy\s+now\b/i },
  { tag: 'promo_code',         weight: 22, phrase: 'promo code',
    pattern: /\bpromo\s+code\b/i },
  { tag: 'percent_off',        weight: 18, phrase: 'X% off',
    pattern: /\b\d{1,3}%\s+off\b/i },
  { tag: 'free_shipping',      weight: 16, phrase: 'free shipping',
    pattern: /\bfree\s+shipping\b/i },
  { tag: 'giveaway',           weight: 22, phrase: 'giveaway',
    pattern: /\bgive[-\s]?away\b/i },
  { tag: 'link_in_bio',        weight: 20, phrase: 'link in bio',
    pattern: /\blink\s+in\s+(bio|description)\b/i },
  { tag: 'visit_my',           weight: 18, phrase: 'visit my',
    pattern: /\bvisit\s+my\b/i },
  { tag: 'click_link',         weight: 18, phrase: 'click the link',
    pattern: /\bclick\s+(the\s+)?link\b/i },
  { tag: 'dm_for_promo',       weight: 18, phrase: 'DM me for',
    pattern: /\bdm\s+me\s+for\s+(promo|sale|offer|business|booking)\b/i },
  { tag: 'hashtag_dense',      weight: 14, phrase: 'hashtag dense',
    pattern: /(#\w+\s*){6,}/i },
  { tag: 'emoji_dense',        weight: 12, phrase: 'emoji dense',
    pattern: /(\p{Emoji}\s*){8,}/u },
]

// ── Constants exposed for callers ────────────────────────────────────────────

const SCORING_WEIGHTS = {
  pain:      0.35,
  buyer:     0.35,
  emotion:   0.20,
  nigeria:   0.10,
}

const QUALITY_THRESHOLDS = {
  hot:    70,
  warm:   45,
  cold:   25,
  // anything < cold OR spam/fake → reject
}

const RECOMMENDED_ACTIONS = [
  'consult_offer',
  'product_offer',
  'academy_offer',
  'reseller_offer',
  'nurture_only',
  'reject',
]

// ── Buying-stage thresholds (used by buyerReadinessService) ──────────────────

const BUYING_STAGES = [
  'unaware',           // no pain, no problem named
  'problem_aware',     // pain or problem named, no shopping intent
  'solution_aware',    // looking, considering, comparing
  'product_aware',     // mentions specific products / asks recommendations
  'most_aware',        // ready to buy now: price, link, where, DM
]

const PROBLEM_AWARENESS_LEVELS = [
  'unaware',
  'problem_aware',
  'solution_aware',
  'product_aware',
  'most_aware',
]

module.exports = {
  PAIN_SIGNALS,
  BUYER_SIGNALS,
  PROBLEM_SIGNALS,
  DESIRE_SIGNALS,
  LOCALITY_SIGNALS,
  HISTORY_SIGNALS,
  LOW_QUALITY_SIGNALS,
  SCORING_WEIGHTS,
  QUALITY_THRESHOLDS,
  RECOMMENDED_ACTIONS,
  BUYING_STAGES,
  PROBLEM_AWARENESS_LEVELS,
}
