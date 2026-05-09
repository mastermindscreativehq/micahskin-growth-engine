// Claude Content Client
// Anthropic SDK wrapper with prompt caching for Micahskin Content Intelligence Engine
// Handles content generation with Nigerian skincare strategist persona

const Anthropic = require('@anthropic-ai/sdk');
const painPointService = require('./painPointDatabaseService');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// System prompt — cached to reduce token usage
const SYSTEM_PROMPT = `You are the Micahskin Content Intelligence Engine — a Nigerian skincare growth strategist and viral content specialist.

You deeply understand:
- Nigerian skincare pain points: acne, hyperpigmentation, dark spots, oily skin, stretch marks, uneven tone, dry skin, sensitive skin
- How Nigerian women (18–45) talk on TikTok, Instagram, Facebook, WhatsApp
- Naija slang that lands naturally: "abeg", "wahala", "sis", "e don do", "you go thank yourself", "no cap", "it's giving..."
- Emotional triggers that stop scrolling: pain, frustration, aspiration, transformation, proof
- Platform nuances: TikTok needs fast-paced hooks; Instagram Reels are similar but slightly more polished; Facebook allows longer narratives; WhatsApp is conversational and direct

Brand Context:
- Micahskin: Nigerian skincare brand + Micahskin Academy (education/entrepreneurship) + Growth OS (business system)
- Core message: Pain → Solution → Transformation
- Primary funnel: Telegram bot for diagnosis and nurturing
- Tone: Warm, empathetic, Nigerian-authentic, confident — never corporate or generic

Content Philosophy:
- PAIN-FIRST always. Nigerian women don't stop for generic beauty tips — they stop when you name their exact pain in words they recognize
- Use Nigerian English naturally where it flows, not forced
- Every piece has ONE clear CTA
- Move viewers toward: Telegram diagnosis, Academy enrollment, or Micahskin system

You generate structured JSON. Validate all output as valid JSON before returning.`;

const claudeContentClient = {
  // ═══════════════════════════════════════════════════════════════════════════════════
  // CORE API CALLS (with prompt caching)
  // ═══════════════════════════════════════════════════════════════════════════════════

  // Internal: Build cached category context for prompt reuse
  _buildCategoryContext(painCategory) {
    return painPointService.buildCategoryContext(painCategory);
  },

  // Internal: Strip markdown code fences and parse JSON response from Claude
  _parseJSON(text) {
    const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    return JSON.parse(stripped)
  },

  // Internal: Call Claude with caching
  async _callClaude(userPrompt, model = 'claude-haiku-4-5-20251001', systemBlocks = []) {
    const messages = [
      {
        role: 'user',
        content: [
          ...systemBlocks, // Category context blocks (cached)
          {
            type: 'text',
            text: userPrompt, // The actual request (not cached)
          },
        ],
      },
    ];

    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }, // Cached for 5min
        },
      ],
      messages,
    });

    return response.content[0].text;
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // SHORT-FORM VIDEO SCRIPTS (TikTok, Instagram Reels)
  // ═══════════════════════════════════════════════════════════════════════════════════

  async generateShortFormScript({
    painCategory = 'general',
    platform = 'tiktok',
    pillar = 'pain_point',
    durationSeconds = 60,
  }) {
    const categoryContext = {
      type: 'text',
      text: this._buildCategoryContext(painCategory),
      cache_control: { type: 'ephemeral' },
    };

    const platformNotes = {
      tiktok: 'Fast-paced, punchy, max 10 words per sentence. Hook in first 2 seconds. Vertical format.',
      instagram_reel: 'Slightly more polished than TikTok. Hook in first 2 seconds. Vertical format.',
      facebook: 'Can be longer and more narrative. Hook first, then story.',
    };

    const pillarContext = {
      pain_point: 'Focus on the problem, make them feel seen. "Does this sound like you?" approach.',
      academy: 'Position Micahskin Academy as the solution. Education + earning potential angle.',
      growth_os: 'Showcase the system that makes Micahskin work. Business/scale angle.',
      authority: 'Build trust. "We\'ve helped thousands..." or transformation proof.',
      conversion_cta: 'Direct push to take action. Time-sensitive, urgent tone. Clear next step.',
    };

    const prompt = `
Generate a short-form video script for ${platform} about ${painCategory} in the ${pillar} pillar.

Platform requirements: ${platformNotes[platform]}
Pillar approach: ${pillarContext[pillar]}
Duration: ${durationSeconds} seconds (roughly ${Math.round(durationSeconds / 2)} words)

Return ONLY valid JSON with this exact structure (no markdown, no code blocks):
{
  "hook": "The first 1-2 sentences that stop the scroll (under 10 words total, under 7 seconds spoken)",
  "problem_setup": "2-3 sentences naming the exact pain point. Make them feel SEEN.",
  "agitate": "1-2 sentences. Make it worse. Why they NEED to fix this.",
  "solution_reveal": "1-2 sentences. What Micahskin offers. No product details yet, just the benefit.",
  "cta": "The call to action. For ${pillar}: ${pillar === 'conversion_cta' ? 'DM START on Telegram' : pillar === 'academy' ? 'Link in bio to join Academy' : pillar === 'growth_os' ? 'See how we do it — link in bio' : 'DM us on Telegram for your diagnosis'}",
  "naija_flavor_additions": "2-3 Naija slang words or expressions to naturally weave in (use sparingly, only if they fit)",
  "script_sections": ["hook", "problem_setup", "agitate", "solution_reveal", "cta"]
}`;

    const response = await this._callClaude(prompt, 'claude-sonnet-4-6', [categoryContext]);
    return this._parseJSON(response);
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // CAROUSEL SCRIPTS (Instagram, Facebook)
  // ═══════════════════════════════════════════════════════════════════════════════════

  async generateCarousel({
    painCategory = 'general',
    platform = 'instagram_reel',
    pillar = 'pain_point',
    slideCount = 5,
  }) {
    const categoryContext = {
      type: 'text',
      text: this._buildCategoryContext(painCategory),
      cache_control: { type: 'ephemeral' },
    };

    const prompt = `
Generate a ${slideCount}-slide carousel about ${painCategory} for ${platform} in the ${pillar} pillar.

Slide structure:
- Slide 1: Hook/attention slide (big emotional statement or question)
- Slides 2-3: Deep into the problem (validation, agitation)
- Slides 4-5: Solution approach (what Micahskin does)
- Last slide: CTA (call to action)

Each slide heading max 10 words. Each body text max 30 words for mobile readability.

Return ONLY valid JSON:
{
  "hook_slide": {
    "heading": "The headline that stops scrolling",
    "body": "1-2 sentences of context"
  },
  "problem_slides": [
    {
      "slide_number": 2,
      "heading": "Problem slide 1 heading",
      "body": "Body text validating their pain"
    },
    {
      "slide_number": 3,
      "heading": "Problem slide 2 heading",
      "body": "Body text agitating the problem"
    }
  ],
  "solution_slides": [
    {
      "slide_number": 4,
      "heading": "Solution approach heading",
      "body": "How Micahskin solves this"
    },
    {
      "slide_number": 5,
      "heading": "Result/benefit heading",
      "body": "What transformation looks like"
    }
  ],
  "cta_slide": {
    "heading": "Call to action heading",
    "body": "CTA text (DM us / Join Academy / etc)",
    "cta_text": "The button/link text"
  }
}`;

    const response = await this._callClaude(prompt, 'claude-sonnet-4-6', [categoryContext]);
    return this._parseJSON(response);
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // HOOK GENERATOR (5 viral hooks)
  // ═══════════════════════════════════════════════════════════════════════════════════

  async generateHookVariants({
    painCategory = 'general',
    platform = 'tiktok',
    pillar = 'pain_point',
    count = 5,
  }) {
    const categoryContext = {
      type: 'text',
      text: this._buildCategoryContext(painCategory),
      cache_control: { type: 'ephemeral' },
    };

    const hookContext = {
      type: 'text',
      text: painPointService.buildHookContext(painCategory),
      cache_control: { type: 'ephemeral' },
    };

    const prompt = `
Generate ${count} DIFFERENT viral hooks for ${platform} about ${painCategory} in the ${pillar} pillar.

Each hook must:
- Be under 12 words
- Be spokenable (no character symbols)
- Use a different hook framework (question, statement, shock, story, contrarian)
- Be specific to Nigerian audience
- NOT be clickbait (must deliver on the promise)

Return ONLY valid JSON:
{
  "hooks": [
    {
      "text": "Hook text here",
      "framework": "question|statement|shock|story|contrarian",
      "platform": "${platform}",
      "pillar": "${pillar}"
    }
  ]
}`;

    const response = await this._callClaude(
      prompt,
      'claude-haiku-4-5-20251001', // Haiku for speed on bulk hook generation
      [categoryContext, hookContext]
    );
    return this._parseJSON(response);
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // CTA GENERATOR
  // ═══════════════════════════════════════════════════════════════════════════════════

  async generatePlatformCTA({
    platform = 'tiktok',
    funnelTarget = 'telegram', // telegram | academy | growth_os
    painCategory = 'general',
  }) {
    const ctaMap = {
      telegram: 'DM START on Telegram for your free skin diagnosis',
      academy: 'Link in bio to join Micahskin Academy and start earning',
      growth_os: 'See how we built this system — link in bio for full breakdown',
    };

    const prompt = `
Generate 3 platform-specific CTA variants for ${platform} pointing to ${funnelTarget}.

Context: ${painCategory} pain point

CTAs must be:
- Short and actionable (max 12 words each)
- Nigerian voice
- Urgency/benefit-focused
- Different framings (curiosity vs urgency vs benefit)

Return ONLY valid JSON:
{
  "cta_variants": [
    {
      "text": "CTA text",
      "tone": "urgency|curiosity|benefit",
      "spokenForm": "How you'd say it naturally"
    }
  ],
  "primary_cta": "The strongest one for this audience"
}`;

    const response = await this._callClaude(prompt, 'claude-haiku-4-5-20251001');
    return this._parseJSON(response);
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // NAIJA LOCALIZATION PASS
  // ═══════════════════════════════════════════════════════════════════════════════════

  async localizeWithNaijaTone(content, { platform = 'tiktok', urgency = 'medium' } = {}) {
    const prompt = `
Take this skincare content and add Nigerian authenticity. DO NOT REWRITE.

Original content:
"${content}"

Task: Inject 1-3 Naija expressions where they naturally fit. Keep the structure. Just add flavor.

Examples of natural Naija additions:
- "abeg" (please/I'm begging you)
- "e don do" (it's enough/stop)
- "no cap" (no lie)
- "wahala" (trouble/problem)
- "it's giving..." (it looks like...)
- "you go thank yourself" (you'll be grateful)
- "chai" (expression of shock)
- "sis" (friendly term)

Platform: ${platform}
Urgency: ${urgency}

Return ONLY the modified text (no JSON, no explanation, just the text).`;

    const response = await this._callClaude(
      prompt,
      'claude-haiku-4-5-20251001',
      [] // No caching needed for localization pass
    );

    return response.trim();
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // CAPTION GENERATOR (single image posts)
  // ═══════════════════════════════════════════════════════════════════════════════════

  async generateCaption({
    painCategory = 'general',
    platform = 'facebook',
    pillar = 'pain_point',
  }) {
    const categoryContext = {
      type: 'text',
      text: this._buildCategoryContext(painCategory),
      cache_control: { type: 'ephemeral' },
    };

    const prompt = `
Generate a caption for a ${platform} post about ${painCategory} in the ${pillar} pillar.

For ${platform}: ${
      platform === 'facebook'
        ? 'Longer form (100-150 words), storytelling, community feel'
        : 'Shorter (30-50 words), direct, hook-focused'
    }

Return ONLY valid JSON:
{
  "hook": "Opening line that stops scroll",
  "body": "Main caption text",
  "cta": "Call to action",
  "hashtags": ["#skincare", "#nigerian", "#micahskin"],
  "platform": "${platform}"
}`;

    const response = await this._callClaude(prompt, 'claude-haiku-4-5-20251001', [categoryContext]);
    return this._parseJSON(response);
  },

  // ═══════════════════════════════════════════════════════════════════════════════════
  // WHATSAPP STATUS GENERATOR
  // ═══════════════════════════════════════════════════════════════════════════════════

  async generateWhatsAppStatus({
    painCategory = 'general',
    pillar = 'pain_point',
  }) {
    const prompt = `
Generate a WhatsApp Status caption about ${painCategory} in the ${pillar} pillar.

WhatsApp Status style: Conversational, warm, like texting a friend.
Length: 2-3 short sentences (max 50 words)
Include: Pain recognition → benefit → CTA

Return ONLY valid JSON:
{
  "status_text": "The caption",
  "cta": "Action text",
  "emoji_suggestions": ["🧴", "✨"]
}`;

    const response = await this._callClaude(prompt, 'claude-haiku-4-5-20251001');
    return this._parseJSON(response);
  },
};

module.exports = claudeContentClient;
