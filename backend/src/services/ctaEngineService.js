// CTA Engine Service
// Dynamic, platform-native CTAs — no direct bot DM references
// All CTAs drive to bio/profile link in a natural, high-converting way

const CTA_LIBRARY = {
  soft: [
    "Link in bio when you're ready.",
    "Everything is in the bio if you want to explore.",
    "The resource is already in our bio — no pressure.",
    "Check the bio. No hard sell, just results.",
    "It's all there in the bio. Take your time.",
    "The training is free to start. Bio link is live.",
    "We put everything in the bio so you can decide for yourself.",
  ],
  authority: [
    "Link in bio before you waste more money on random skincare.",
    "The system is in the bio. Built by someone who figured this out the hard way.",
    "You'll understand why your brand is stuck after watching the training in the bio.",
    "The framework is in the bio. Free to access.",
    "This is the approach that actually works. Bio has everything.",
    "Years of lessons condensed into one place. It's in the bio.",
    "The AI growth system is already linked in the profile.",
  ],
  curiosity: [
    "Something in the bio explains exactly why this keeps happening.",
    "There's a free resource in the bio that makes all of this make sense.",
    "The answer to why nothing is working is already in the bio.",
    "Check the bio. I can't explain it all here — but it's there.",
    "The training in the bio will change how you see this completely.",
    "It's a long story. The bio tells it better than I can here.",
    "The thing that changes everything for most people is linked in the bio.",
  ],
  luxury: [
    "The full system is in our bio — built for serious brand owners only.",
    "The AI growth system is already linked in the profile.",
    "If you build at this level, everything you need is in the bio.",
    "Not for everyone. But if it's for you — it's in the bio.",
    "For the woman who's done settling. Link in bio.",
    "This is premium. The system in our bio reflects that.",
    "Everything worth knowing is already in the bio.",
  ],
  urgency: [
    "Link in bio before you waste another month on random strategies.",
    "The enrollment in the bio closes soon — seats are limited.",
    "Don't wait. The bio link is live now. Act on it.",
    "Every month you delay costs you more. Bio link is live.",
    "The next cohort fills fast. Check the bio now.",
    "This won't be available forever. Bio link is up now.",
    "Stop delaying. The answer is in the bio right now.",
  ],
  founder: [
    "This is what I built my brand with. It's all in the bio.",
    "If you're serious about scaling your skincare brand, check the bio.",
    "The system I wish I had from day one is in the bio.",
    "I share the full playbook in the bio. No gatekeeping.",
    "Everything I've learned building this is in the bio. Free.",
    "The AI growth system is already linked in the profile.",
    "I document everything. The bio has all of it.",
  ],
  educational: [
    "If you want to understand this deeper, there's a full breakdown in the bio.",
    "The training that walks you through all of this is in our bio.",
    "The resource in the bio will save you months of trial and error.",
    "Full breakdown in the bio. Everything I know about this is there.",
    "I built a free training around this. It's in the bio.",
    "The bio has the full system. Start there.",
    "You'll learn more from the bio resource than from scrolling for hours.",
  ],
  anti_sales: [
    "Don't just post. Build a machine. Link in bio.",
    "The system that fixed this is already in the bio.",
    "I'm not here to sell you anything. Just check the bio.",
    "You don't need me to convince you. The bio speaks for itself.",
    "If you're already convinced — bio link is live.",
    "No pitch. Just results. Bio has the details.",
    "The proof is in the bio. Make your own decision.",
  ],
};

// Maps content pillar to ideal CTA styles (ordered by priority)
const PILLAR_CTA_STYLE_MAP = {
  pain_point:     ['curiosity', 'soft', 'anti_sales'],
  academy:        ['authority', 'founder', 'urgency'],
  growth_os:      ['authority', 'founder', 'educational'],
  authority:      ['authority', 'educational', 'curiosity'],
  conversion_cta: ['urgency', 'anti_sales', 'luxury'],
};

// Platform tone modifiers (informational, not switching CTAs)
const PLATFORM_TONE = {
  tiktok:          'fast, punchy, casual',
  instagram_reel:  'premium, aspirational',
  facebook:        'warm, conversational',
  whatsapp_status: 'personal, direct',
};

// Session-level recency tracking to avoid repeating CTAs
const _recentlyUsed = new Set();
const MAX_RECENT = 24;

function _markUsed(cta) {
  _recentlyUsed.add(cta);
  if (_recentlyUsed.size > MAX_RECENT) {
    const oldest = _recentlyUsed.values().next().value;
    _recentlyUsed.delete(oldest);
  }
}

const ctaEngineService = {
  CTA_STYLES: Object.keys(CTA_LIBRARY),
  PLATFORM_TONE,

  // Get a single intelligently-selected CTA
  getCTA({ style = null, pillar = 'pain_point', platform = 'tiktok' } = {}) {
    const targetStyle = style || this._pickStyleForContext(pillar, platform);
    const candidates = CTA_LIBRARY[targetStyle] || CTA_LIBRARY.soft;
    const fresh = candidates.filter(c => !_recentlyUsed.has(c));
    const pool = fresh.length > 0 ? fresh : candidates;
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    _markUsed(chosen);
    return { text: chosen, style: targetStyle };
  },

  // Get multiple CTA variants across different styles
  getCTAVariants({ pillar = 'pain_point', platform = 'tiktok', count = 3 } = {}) {
    const styles = PILLAR_CTA_STYLE_MAP[pillar] || ['soft', 'curiosity', 'authority'];
    return styles.slice(0, count).map(style => {
      const pool = CTA_LIBRARY[style] || CTA_LIBRARY.soft;
      const fresh = pool.filter(c => !_recentlyUsed.has(c));
      const candidates = fresh.length > 0 ? fresh : pool;
      const text = candidates[Math.floor(Math.random() * candidates.length)];
      return { text, style };
    });
  },

  // Get all CTAs organized by style
  getAllCTAs() {
    return CTA_LIBRARY;
  },

  // Get CTAs for a specific style
  getCTAsByStyle(style) {
    return CTA_LIBRARY[style] || [];
  },

  _pickStyleForContext(pillar, platform) {
    const styles = PILLAR_CTA_STYLE_MAP[pillar] || ['soft', 'curiosity'];
    return styles[Math.floor(Math.random() * styles.length)];
  },
};

module.exports = ctaEngineService;
