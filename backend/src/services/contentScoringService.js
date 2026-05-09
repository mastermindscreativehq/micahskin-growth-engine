// Content Scoring Engine
// Scores generated content across 5 intelligence dimensions (0–100 each)
// Used to identify patterns, surface top performers, and guide future generation

const POWER_WORDS = [
  'free', 'secret', 'finally', 'truth', 'never', 'worst', 'best', 'proven',
  'instant', 'real', 'stop', 'hidden', 'wrong', 'mistake', 'fix', 'exactly',
  'before', 'after', 'transform', 'skin', 'acne', 'why', 'how', 'most',
  'money', 'waste', 'build', 'scale', 'system', 'machine', 'broke', 'stuck',
  'watch', 'listen', 'warning', 'confess', 'admit', 'broke', 'ruining',
];

const EMOTIONAL_TRIGGERS = {
  pain_point:     ['struggling', 'tried everything', 'nothing works', 'embarrassing', 'frustrated', 'tired', 'hurts', 'waste', 'hate', 'stuck', 'ruining', 'desperate', 'gave up'],
  academy:        ['scale', 'build', 'income', 'freedom', 'serious', 'operator', 'machine', 'automated', 'grow', 'business', 'legacy', 'empire'],
  growth_os:      ['system', 'automate', 'scale', 'infrastructure', 'machine', 'compound', 'leverage', 'operate', 'passive'],
  authority:      ['thousands', 'proven', 'results', 'clients', 'transformed', 'verified', 'trusted', 'expert', 'years'],
  conversion_cta: ['limited', 'now', 'before', 'close', 'seats', 'last', 'urgent', 'closing', 'tonight', 'deadline'],
};

const PLATFORM_VIRALITY_BASE = {
  tiktok:          72,
  instagram_reel:  65,
  facebook:        42,
  whatsapp_status: 50,
};

const PILLAR_AUTHORITY_BASE = {
  authority:      80,
  academy:        72,
  growth_os:      70,
  pain_point:     50,
  conversion_cta: 38,
};

const STYLE_CONVERSION_BOOST = {
  'Direct Response': 28,
  'Emotional':       22,
  'Authority':       20,
  'Viral':           18,
  'Founder Story':   16,
  'Luxury':          12,
  'Cinematic':       10,
  'Educational':     10,
  'Documentary':      6,
};

const STRUCTURE_VIRALITY_BOOST = {
  'hook_style':          20,
  'emotional_confession': 18,
  'before_after':        16,
  'cinematic_story':     14,
  'founder_pov':         12,
  'skincare_myth':       12,
  'direct_response':     10,
  'authority_breakdown': 8,
  'ai_growth_lesson':    6,
  'tutorial':            5,
  'mini_documentary':    8,
};

function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

function parseBodySafe(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  try { return JSON.parse(body); } catch { return {}; }
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

function scoreHook(hook) {
  if (!hook || hook.length < 3) return 20;
  let score = 38;
  const lower = hook.toLowerCase();

  // Power words
  const hits = POWER_WORDS.filter(w => lower.includes(w)).length;
  score += Math.min(hits * 7, 28);

  // Word count sweet spot (6–12 words)
  const words = hook.trim().split(/\s+/).length;
  if (words >= 5 && words <= 12)      score += 16;
  else if (words > 12 && words <= 18) score += 6;
  else if (words < 5)                 score -= 5;

  // Question hooks stop scrolls
  if (hook.includes('?')) score += 10;

  // Strong openers
  if (/^(stop|if|why|how|what|this|the\s)/i.test(hook.trim())) score += 8;
  if (/^\d+/.test(hook.trim())) score += 5;

  // Naija phrases = authentic voice boost
  if (/\b(abeg|wahala|e don do|chai|sis|no cap|it's giving)\b/i.test(lower)) score += 5;

  return clamp(score);
}

function scoreEmotional(hook, bodyText, pillar, painCategory) {
  let score = 38;
  const text = `${hook || ''} ${bodyText || ''}`.toLowerCase();

  const triggers = EMOTIONAL_TRIGGERS[pillar] || EMOTIONAL_TRIGGERS.pain_point;
  const matches = triggers.filter(t => text.includes(t)).length;
  score += Math.min(matches * 9, 36);

  // High-emotion pillars
  if (['academy', 'growth_os'].includes(pillar)) score += 10;

  // Pain categories with highest emotional resonance
  if (['acne', 'hyperpigmentation', 'stretch_marks'].includes(painCategory)) score += 10;
  else if (['dark_spots', 'oily_skin', 'dry_skin'].includes(painCategory)) score += 5;

  // Naija audience resonance
  if (/\b(nigerian|african|naija|lagos|abuja|NG)\b/i.test(text)) score += 5;

  return clamp(score);
}

function scoreVirality(hook, platform, pillar, contentStyle, structure) {
  let score = PLATFORM_VIRALITY_BASE[platform] || 50;

  // Hook quality contributes to share-worthiness
  const hookQ = scoreHook(hook);
  score += (hookQ - 50) * 0.3;

  // Content style
  if (contentStyle === 'Viral')       score += 18;
  if (contentStyle === 'Cinematic')   score += 12;
  if (contentStyle === 'Emotional')   score += 10;
  if (contentStyle === 'Founder Story') score += 8;

  // Structure
  score += (STRUCTURE_VIRALITY_BOOST[structure] || 0) * 0.7;

  // Pain content gets shared because it's relatable
  if (pillar === 'pain_point') score += 12;

  return clamp(score);
}

function scoreConversion(pillar, contentStyle, cta) {
  let score = 36;

  const pillarBoost = {
    conversion_cta: 38,
    authority:      26,
    academy:        22,
    growth_os:      22,
    pain_point:     12,
  };
  score += pillarBoost[pillar] || 0;

  score += (STYLE_CONVERSION_BOOST[contentStyle] || 0) * 0.65;

  // CTA quality signals
  if (cta && cta.length > 10)                 score += 5;
  if (cta && /bio/i.test(cta))               score += 6;
  if (cta && /link/i.test(cta))              score += 4;
  if (cta && /before|limited|now/i.test(cta)) score += 5;

  return clamp(score);
}

function scoreAuthority(pillar, contentStyle, claudeModel) {
  let score = PILLAR_AUTHORITY_BASE[pillar] || 50;

  if (contentStyle === 'Authority')     score += 16;
  if (contentStyle === 'Educational')   score += 12;
  if (contentStyle === 'Documentary')   score += 9;
  if (contentStyle === 'Founder Story') score += 9;
  if (contentStyle === 'Luxury')        score += 6;

  // Premium model = richer output
  if (claudeModel && !claudeModel.includes('mini')) score += 6;

  return clamp(score);
}

// ── Main scoring function ─────────────────────────────────────────────────────

const contentScoringService = {
  scorePiece({ hook, body, pillar, painCategory, platform, cta, claudeModel }) {
    const bodyData = parseBodySafe(body);
    const style = bodyData._contentStyle || null;
    const structure = bodyData.content_structure_type || null;
    const bodyText = bodyData.full_script || bodyData.voiceover_script || '';

    const hookScore       = scoreHook(hook);
    const emotionalScore  = scoreEmotional(hook, bodyText, pillar, painCategory);
    const viralityScore   = scoreVirality(hook, platform, pillar, style, structure);
    const conversionScore = scoreConversion(pillar, style, cta);
    const authorityScore  = scoreAuthority(pillar, style, claudeModel);

    const overallScore = clamp(
      hookScore       * 0.25 +
      emotionalScore  * 0.25 +
      viralityScore   * 0.20 +
      conversionScore * 0.20 +
      authorityScore  * 0.10
    );

    const estimatedReach =
      overallScore >= 82 ? 'viral' :
      overallScore >= 66 ? 'high'  :
      overallScore >= 50 ? 'medium': 'low';

    return { hookScore, emotionalScore, viralityScore, conversionScore, authorityScore, overallScore, estimatedReach };
  },

  getScoreLabel(score) {
    if (score >= 82) return 'Viral';
    if (score >= 66) return 'Strong';
    if (score >= 50) return 'Good';
    if (score >= 35) return 'Weak';
    return 'Poor';
  },

  getScoreTier(score) {
    if (score >= 82) return 'S';
    if (score >= 66) return 'A';
    if (score >= 50) return 'B';
    if (score >= 35) return 'C';
    return 'D';
  },
};

module.exports = contentScoringService;
