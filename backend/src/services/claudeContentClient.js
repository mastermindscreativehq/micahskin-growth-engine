// AI Content Client
// Provider abstraction: OpenAI (default) or Anthropic (fallback)
// OpenAI GPT-4.1 mini = bulk generation | GPT-4.1 = premium campaigns
// Claude Sonnet = optional fallback for premium emotional campaigns

const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const painPointService = require('./painPointDatabaseService');

// ── Provider config ───────────────────────────────────────────────────────────

const PROVIDER = process.env.CONTENT_AI_PROVIDER || 'openai';

const OPENAI_MODELS = {
  BULK: 'gpt-4.1-mini',
  PREMIUM: 'gpt-4.1',
};
const ANTHROPIC_MODELS = {
  PREMIUM: 'claude-sonnet-4-6',
};

let _openai = null;
let _anthropic = null;

function openai() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Micahskin Content Intelligence Engine — a strategic content architect for Micahskin, a Nigerian premium skincare brand and growth education company.

BRAND OVERVIEW:
Micahskin operates three interconnected arms:

1. SKINCARE PRODUCTS
   Premium Nigerian skincare solutions for: acne, hyperpigmentation, dark spots, oily skin, stretch marks, uneven tone, dry skin, sensitive skin.
   Target: Nigerian/African women 18–45 who want real, lasting results.

2. MICAHSKIN ACADEMY (₦50k–₦60k — limited enrollment)
   This is NOT a skincare certification. It is an operator-level growth school for ambitious Nigerian women who want to BUILD and SCALE a skincare business.
   The Academy teaches:
   - How to start and scale a skincare brand in Nigeria from scratch
   - Customer acquisition: building systems that bring in customers continuously
   - AI automation: using AI tools to automate lead generation, follow-ups, CRM, content, and customer communication
   - Brand positioning and messaging that attracts premium customers
   - Content systems: building content machines that generate leads 24/7
   - Lead generation: creating acquisition channels that compound over time
   - Growth systems: the full operational stack of a scaling skincare brand
   - Backend infrastructure: CRM, automation, data, business operations
   - Conversion systems: moving strangers to paying customers using psychology and systems
   - Automation thinking: building a business that grows without the owner doing everything manually
   The Academy graduate doesn't just know skincare — they know how to BUILD and SCALE a skincare business using modern AI-driven systems.
   Academy content must feel: ambitious, premium, intelligent, operator-level, "build your own machine" — NOT "simple skincare class."

3. GROWTH OS
   A complete business operating system for skincare entrepreneurs who want to scale beyond personal effort. The full-stack system for brand owners.

PRIMARY FUNNEL:
- All content drives to the bio/profile link — the central hub for diagnosis, Academy enrollment, and Growth OS
- NEVER instruct viewers to DM a bot directly in the content — CTAs should always point to the link in bio
- Bio CTA examples: "Link in bio", "Check the bio", "It's in the bio", "Profile link", "Bio has everything"

AUDIENCE SEGMENTS:
- Skincare consumers: Nigerian/African women 18–45 with real skin pain points
- Aspiring entrepreneurs: Nigerian women who want to build a skincare business or side income
- Brand builders: Skincare entrepreneurs wanting to scale using AI and growth systems

LANGUAGE & TONE:
- Platform-native Nigerian English — warm, confident, intelligent, direct
- 1–2 Naija phrases where they land naturally (never forced): "abeg", "wahala", "e don do", "you go thank yourself", "no cap", "it's giving...", "chai", "sis"
- NEVER corporate. NEVER generic. NEVER "simple beauty class" energy.
- Content should feel human, strategic, filmable, emotionally intelligent, and premium.
- African-market aware — speak to real Nigerian lived experiences.

OUTPUT RULES:
- Return ONLY valid JSON. No markdown fences, no code blocks, no preamble, no explanation.
- Every JSON field must be filled — no nulls unless explicitly optional.
- All content must be creator-ready and production-filmable.`;

// ── Core call functions ───────────────────────────────────────────────────────

async function callOpenAI(userPrompt, { isPremium = false, maxTokens = null } = {}) {
  const model = isPremium ? OPENAI_MODELS.PREMIUM : OPENAI_MODELS.BULK;
  const tokens = maxTokens || (isPremium ? 4000 : 2500);

  const response = await openai().chat.completions.create({
    model,
    max_tokens: tokens,
    temperature: 0.8,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  });

  return { text: response.choices[0].message.content, model };
}

async function callAnthropic(userPrompt, { maxTokens = 4000, systemBlocks = [] } = {}) {
  const model = ANTHROPIC_MODELS.PREMIUM;

  const response = await anthropic().messages.create({
    model,
    max_tokens: maxTokens,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ...systemBlocks,
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  return { text: response.content[0].text, model };
}

async function callAI(userPrompt, { isPremium = false, provider = PROVIDER, maxTokens = null } = {}) {
  if (provider === 'anthropic') {
    return callAnthropic(userPrompt, { maxTokens: maxTokens || 4000 });
  }
  return callOpenAI(userPrompt, { isPremium, maxTokens });
}

function parseJSON(text) {
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(stripped);
}

// ── Academy category context ──────────────────────────────────────────────────

const ACADEMY_CATEGORY_CONTEXT = {
  ai_growth_systems: `Content topic: AI Growth Systems for skincare businesses.
Key insight: Most skincare brand owners are drowning in manual work — answering the same DMs, chasing unpaid invoices, forgetting follow-ups. AI can automate all of this.
Audience: Nigerian skincare entrepreneurs who are exhausted by repetitive tasks and want their business to run more automatically.
Emotional hook: Imagine your business generating leads, qualifying customers, and following up — automatically — while you focus on what you love.`,

  lead_generation: `Content topic: Lead Generation systems for skincare businesses.
Key insight: Most skincare brands rely on luck for customers. The brands that scale have predictable, repeatable acquisition systems.
Audience: Skincare brand owners who want consistent customer flow, not feast-or-famine.
Emotional hook: Stop wondering where your next customer is coming from. Build a machine that brings them to you every single day.`,

  automation: `Content topic: Business automation for skincare entrepreneurs.
Key insight: Automation isn't just for big companies. A one-person skincare brand can run like a 10-person team with the right automation stack.
Audience: Solopreneur skincare founders who want to scale without hiring an army.
Emotional hook: You built this business to have freedom. Let automation give you back your time.`,

  brand_positioning: `Content topic: Brand positioning and premium brand building.
Key insight: In a saturated skincare market, positioning is the difference between "cheap brand" and "premium brand" — even with the same products.
Audience: Skincare entrepreneurs who want to attract premium customers and stop competing on price.
Emotional hook: You don't need cheaper products. You need a stronger brand story. Here's how.`,

  customer_psychology: `Content topic: Customer psychology and buying behavior in Nigerian skincare.
Key insight: Nigerian customers don't buy products — they buy outcomes, trust, and identity. Understanding this changes everything about how you sell.
Audience: Skincare entrepreneurs who want to understand why customers buy (and why they don't).
Emotional hook: The real reason your customers aren't buying has nothing to do with your product price.`,

  conversion_systems: `Content topic: Conversion systems — turning leads and followers into paying customers.
Key insight: Most skincare brands are great at getting attention but terrible at converting it into sales. Conversion is a system, not a talent.
Audience: Skincare brand owners with followers/leads who aren't converting into customers.
Emotional hook: You already have the audience. You're just missing the system to convert them.`,

  backend_infrastructure: `Content topic: Backend business infrastructure for scaling skincare brands.
Key insight: You can't scale a skincare business that only works when you're personally working it. Infrastructure means your business runs without you being present for every step.
Audience: Skincare entrepreneurs who want to scale beyond personal capacity.
Emotional hook: The difference between a job and a business is infrastructure. Here's what yours needs.`,

  content_systems: `Content topic: Content creation systems for consistent lead generation.
Key insight: One viral post won't build your business. A content system that produces consistently is what compounds.
Audience: Skincare entrepreneurs who want content to work as a growth channel, not just a vanity metric.
Emotional hook: Stop posting and hoping. Start building a content machine that works for you 24/7.`,

  skincare_business: `Content topic: Building and running a skincare business in Nigeria.
Key insight: Starting a skincare brand in Nigeria is easier than ever — but building one that actually scales takes systems, positioning, and smart execution.
Audience: Nigerian women who want to start or grow a skincare brand.
Emotional hook: You already have the passion. Here's the blueprint to build the business around it.`,

  authority_building: `Content topic: Building authority and trust as a skincare expert or brand.
Key insight: In Nigeria's skincare market, the brands that win are the ones customers trust the most — not necessarily the cheapest or most polished.
Audience: Skincare entrepreneurs who want to be seen as THE go-to authority in their niche.
Emotional hook: Before customers buy your products, they buy YOU. Here's how to build that authority.`,
};

// ── Content structure definitions ─────────────────────────────────────────────

const CONTENT_STRUCTURES = `
Available content structures (choose the most powerful for the given inputs):
- hook_style: Lightning-fast. Hook → Problem flash → Solution hint → CTA. 2–3 segments. Best for TikTok, 15–30s.
- cinematic_story: Narrative arc with emotional beats. Setup → Tension → Revelation → Transformation → CTA. 4–5 segments. Best for 45–60s reels.
- authority_breakdown: Expert teaching format. Hook → 3–4 key insights → Authority CTA. 4–5 segments. Best for credibility content.
- tutorial: Step-by-step how-to. Hook → 3–4 steps → Result → CTA. 5–6 segments. Best for educational content.
- founder_pov: Personal brand story. Vulnerable opening → Story → Lesson → Invitation. 4 segments. Works on all platforms.
- emotional_confession: Raw and vulnerable. Shared struggle → Breaking point → Discovery → Transformation → CTA. 4–5 segments.
- before_after: Transformation proof. Before pain → Turning point → After result → Proof → CTA. 4–5 segments.
- ai_growth_lesson: Business/Academy content. Context (the problem most face) → The Insight → The System → The Result → CTA. 4–5 segments.
- skincare_myth: Education format. The myth → Why it's wrong → The truth → The solution → CTA. 4–5 segments.
- mini_documentary: Premium narrative. Introduction → Journey → Struggle → Breakthrough → Lesson → CTA. 5–6 segments.
- direct_response: Conversion-optimized. Problem → Urgency → Specific offer → Proof → CTA. 3–4 segments.
`;

// ── Style prompts ─────────────────────────────────────────────────────────────

const STYLE_PROMPTS = {
  Cinematic: 'Cinematic style: Slow-burn storytelling, rich visual metaphors, dramatic tension, emotional depth. Every sentence should paint a picture. Pacing is deliberate.',
  Luxury: 'Luxury style: Premium, aspirational tone. Words that evoke quality, exclusivity, transformation. No urgency — confidence. The brand comes to you.',
  Authority: 'Authority style: Expert-led, data-informed, confident. Zero fluff. Teach first, sell second. Every claim backed by logic or social proof.',
  Emotional: 'Emotional style: Deep empathy, vulnerability, real human moments. The audience feels understood before they feel sold to. Emotional truth over polish.',
  Educational: 'Educational style: Clear, structured, insight-first. Break down complex ideas simply. Audience learns something real. Builds trust through knowledge.',
  Viral: 'Viral style: Pattern-interrupting, shareable, surprising. Unexpected angle, bold statement, or counterintuitive truth that makes people stop and share.',
  Documentary: 'Documentary style: Observational, behind-the-scenes, authentic process footage. "Day in the life" energy. Feels real, not scripted.',
  'Founder Story': 'Founder Story style: First-person, personal brand POV. Vulnerable, specific, and honest. The founder IS the brand. Raw personal credibility.',
  'Direct Response': 'Direct Response style: Conversion-optimized every line. Clear problem, clear solution, clear offer, clear next step. No ambiguity, no wasted words.',
};

const OBJECTIVE_PROMPTS = {
  'Lead Generation': 'Objective — Lead Generation: Drive cold audience to discover the brand. Prioritize hook and awareness. CTA points to bio link.',
  'Bio Link Conversion': 'Objective — Bio Link Conversion: Move warm audience to click the link in bio. Primary CTA is a natural, compelling bio reference.',
  'Academy Sales': 'Objective — Academy Sales: Drive enrollment for Micahskin Academy (₦50k–₦60k). Lead with transformation and business outcome. CTA points to bio link for enrollment.',
  'Product Sales': 'Objective — Product Sales: Drive direct product purchase. Feature the product transformation. CTA is the bio link for product details.',
  'Brand Awareness': 'Objective — Brand Awareness: Build brand recognition and affinity. Prioritize relatability and brand storytelling. Soft bio CTA.',
  Engagement: 'Objective — Engagement: Maximize saves, shares, comments, and watch time. Ask a question or create a "save this" moment. Soft CTA.',
  'Authority Positioning': 'Objective — Authority Positioning: Position Micahskin as THE expert authority. Educate first, mention brand as proof. CTA points to bio.',
};

// ── Live signal injection ─────────────────────────────────────────────────────
// Builds a "REAL AUDIENCE SIGNALS" block from analyzed MarketSignal phrases.
// Injected into every generation prompt so AI uses authentic audience language.

function buildLiveSignalsBlock(liveSignals = []) {
  if (!liveSignals || liveSignals.length === 0) return '';

  const lines = liveSignals
    .slice(0, 10)
    .map(s => `  • [${s.type}] "${s.phrase}" — seen ${s.frequency}× (emotion ${s.emotionalIntensity}/100)`)
    .join('\n');

  return `\nREAL AUDIENCE SIGNALS (use these exact phrases or adapt them naturally into the content):
${lines}
Use at least 1–2 of these real phrases verbatim where they fit naturally. They come directly from your audience.\n`;
}

// ── Main generation function ──────────────────────────────────────────────────

async function generateShortFormScript({
  painCategory = 'general',
  platform = 'tiktok',
  pillar = 'pain_point',
  durationSeconds = 60,
  contentStyle = null,
  objective = null,
  liveSignals = [],
}) {
  const isAcademy = pillar === 'academy' || pillar === 'growth_os';
  const isPremiumStyle = contentStyle && ['Cinematic', 'Documentary', 'Founder Story', 'Luxury'].includes(contentStyle);
  const isPremium = isAcademy || isPremiumStyle;

  // Build category context
  let categoryContext = '';
  if (ACADEMY_CATEGORY_CONTEXT[painCategory]) {
    categoryContext = ACADEMY_CATEGORY_CONTEXT[painCategory];
  } else {
    categoryContext = painPointService.buildCategoryContext(painCategory);
  }

  const platformNotes = {
    tiktok: 'TikTok: Fast cuts required. Hook must land in first 1–2 seconds. Max 8 words per sentence. Trending audio-friendly. Gen-Z and Millennial Nigerian women.',
    instagram_reel: 'Instagram Reels: Slightly more polished than TikTok. Hook in first 2 seconds. Clean aesthetic. Millennial Nigerian women 25–40.',
    facebook: 'Facebook: Slightly slower pace acceptable. Hook first, then story. Nigerian women 25–45. Can support longer narrative.',
  };

  const pillarContext = {
    pain_point: 'Pillar — Pain Point: Focus entirely on the skin pain. Make her feel deeply understood. Name the exact frustration with specificity. Lead to Telegram diagnosis.',
    academy: 'Pillar — Academy: Position Micahskin Academy as the life-changing operator school. This is not just about skincare — it is about building a business that scales. Lead with the transformation of what she can BUILD, not just what she can learn.',
    growth_os: 'Pillar — Growth OS: Show the Growth OS as the complete business operating system. Speak to skincare entrepreneurs who want systematic scale. "This is how we built a brand that actually grows."',
    authority: 'Pillar — Authority: Build trust and social proof. Transformation results, thousands helped, real Nigerian women changing their skin and their income.',
    conversion_cta: 'Pillar — Conversion CTA: Direct, urgent invitation to take action. Time-sensitive or limited availability framing. No fluff. Clear next step.',
  };

  const styleNote = contentStyle && STYLE_PROMPTS[contentStyle] ? STYLE_PROMPTS[contentStyle] : 'Style: Authentic Nigerian creator energy — real, warm, strategic.';
  const objectiveNote = objective && OBJECTIVE_PROMPTS[objective] ? OBJECTIVE_PROMPTS[objective] : 'Objective: Drive awareness and move viewer toward Telegram diagnosis or Academy enrollment.';

  const liveSignalsBlock = buildLiveSignalsBlock(liveSignals);

  const prompt = `Generate a COMPLETE production-ready ${platform} video script for Micahskin.

CATEGORY CONTEXT:
${categoryContext}
${liveSignalsBlock}
CONTENT PARAMETERS:
Platform: ${platformNotes[platform] || platformNotes.tiktok}
Pillar: ${pillarContext[pillar] || pillarContext.pain_point}
${styleNote}
${objectiveNote}
Target duration: ${durationSeconds} seconds

${CONTENT_STRUCTURES}

TASK:
1. Choose the most powerful content_structure_type from the list above based on the given platform, pillar, style, and objective.
2. Generate the appropriate number of segments for that structure (minimum 2, maximum 7).
3. Do not default to exactly 4 segments — choose what the structure demands.

Return ONLY valid JSON (no markdown, no code blocks):
{
  "content_title": "Compelling, click-worthy title under 12 words that a Nigerian woman would tap",
  "content_structure_type": "chosen_structure_from_list",
  "target_audience": "Nigerian women [specific age range] who [exact situation and pain being experienced]",
  "hook": "Opening hook line — under 10 words, punchy, stops the scroll completely.",
  "full_script": "Complete word-for-word script as spoken naturally. Conversational Nigerian tone. 1–2 Naija phrases max. 80–140 words depending on duration.",
  "segments": [
    {
      "segment_number": 1,
      "segment_title": "Title of this beat",
      "duration": "0–Xs",
      "visual_direction": "Specific camera direction and framing. What the viewer sees.",
      "acting_direction": "How the person should perform — emotion, energy, eye contact, movement.",
      "on_screen_text": "Text overlay. Short, bold, punchy. Max 8 words.",
      "voiceover": "Exact words spoken in this segment."
    }
  ],
  "shot_list": [
    {"shot_number": 1, "shot_type": "Close-up talking head", "description": "Specific description of what this shot captures"},
    {"shot_number": 2, "shot_type": "B-roll", "description": "Specific supporting visual"}
  ],
  "voiceover_script": "The complete spoken script as one continuous read — clean, natural, production-ready.",
  "caption": "Full post caption ready to paste. Hook first. 2–4 sentences. 2–3 natural emojis. CTA. Hashtag placeholder.",
  "cta": "The primary call to action — one direct, warm sentence pointing to the bio link. Platform-native tone. Examples: 'Link in bio before you waste more money.' / 'The system that fixed this is already in the bio.' / 'Check the bio — everything is there.'",
  "bio_cta": "A natural, conversational bio reference that doesn't feel like an ad. Under 12 words.",
  "hashtags": ["#micahskin", "#nigerianwomen", "#africanskincare", "#skincareadvice", "#growthmindset"],
  "props_needed": ["List of specific props or items needed to film this"],
  "suggested_music_mood": "Specific vibe: genre, energy, tempo. Should fit ${platform} trending audio for Nigerian content in 2025.",
  "filming_instructions": "3–4 practical sentences: camera setup, lighting, location, pacing, wardrobe.",
  "editing_instructions": "3–4 practical sentences: cut timing, text overlay style, audio, transitions, effects.",
  "posting_angle": "The strategic angle and why this specific approach will convert Nigerian viewers in 2025.",
  "academy_cta": ${isAcademy ? '"Join Micahskin Academy — limited enrollment. Build the skincare business and AI growth systems that work while you sleep. (₦50k–₦60k) — Link in bio."' : 'null'},
  "growth_os_cta": ${pillar === 'growth_os' ? '"Get the full Growth OS system — the complete stack for scaling your skincare brand. Link in bio."' : 'null'}
}`;

  const { text, model } = await callAI(prompt, { isPremium });
  const parsed = parseJSON(text);
  return { ...parsed, _aiModel: model };
}

async function generateWhatsAppStatus({ painCategory = 'general', pillar = 'pain_point', contentStyle = null, objective = null, liveSignals = [] }) {
  const isAcademy = pillar === 'academy' || pillar === 'growth_os';
  let categoryContext = ACADEMY_CATEGORY_CONTEXT[painCategory] || painPointService.buildCategoryContext(painCategory);

  const styleNote = contentStyle && STYLE_PROMPTS[contentStyle] ? STYLE_PROMPTS[contentStyle] : '';
  const objectiveNote = objective && OBJECTIVE_PROMPTS[objective] ? OBJECTIVE_PROMPTS[objective] : '';

  const pillarNote = {
    pain_point: 'Lead with the pain, build empathy, end with free Telegram diagnosis offer.',
    academy: 'Lead with business transformation or earning potential. The Academy teaches you to BUILD a skincare business, not just learn skincare. End with Academy enrollment.',
    growth_os: 'Lead with business scale. Show what systematic growth looks like. End with Growth OS.',
    authority: 'Lead with real transformation result. End with consultation or Telegram.',
    conversion_cta: 'Lead with urgency or limited offer. End with direct action step.',
  };

  const liveSignalsBlock = buildLiveSignalsBlock(liveSignals);

  const prompt = `Generate a WhatsApp Status campaign (5 slides) for Micahskin.

CATEGORY CONTEXT:
${categoryContext}
${liveSignalsBlock}
Pillar: ${pillarNote[pillar] || pillarNote.pain_point}
${styleNote}
${objectiveNote}
Style: Warm, conversational — like a trusted knowledgeable friend texting you. Not salesy.
Each slide text: max 60 words. Short enough to read in one glance.

Return ONLY valid JSON:
{
  "content_title": "WhatsApp campaign title under 8 words",
  "target_audience": "Nigerian women [specific age] dealing with [exact pain or goal]",
  "status_slides": [
    {
      "slide_number": 1,
      "slide_text": "Hook slide — names the pain or asks the relatable question. Warm Nigerian tone. Max 40 words.",
      "image_video_idea": "Specific image or short clip idea that pairs with this slide.",
      "cta": "Swipe/tap instruction for this slide."
    },
    {
      "slide_number": 2,
      "slide_text": "Validation — you understand exactly what they're going through. Makes them feel seen.",
      "image_video_idea": "Image or clip idea.",
      "cta": "Gentle nudge to continue."
    },
    {
      "slide_number": 3,
      "slide_text": "Insight — one surprising or eye-opening truth about this skin issue or business challenge.",
      "image_video_idea": "Visual for insight.",
      "cta": "Curiosity hook to next slide."
    },
    {
      "slide_number": 4,
      "slide_text": "Solution — what Micahskin does differently. Benefit-focused, not product-pushy.",
      "image_video_idea": "Micahskin product, result, or brand visual.",
      "cta": "Soft CTA to final slide."
    },
    {
      "slide_number": 5,
      "slide_text": "CTA slide — clear, warm, direct action. Tell them exactly where to go. Reference the bio link naturally.",
      "image_video_idea": "Brand logo or clean CTA graphic with bio arrow.",
      "cta": "Link in bio — everything is already there."
    }
  ],
  "posting_angle": "Why this WhatsApp sequence will convert Nigerian viewers who see it.",
  "bio_cta": "Natural bio reference — under 10 words, platform-native, no hard sell.",
  "academy_cta": ${isAcademy ? '"Join Micahskin Academy — build your skincare business with AI growth systems (₦50k–₦60k). Link in bio."' : 'null'}
}`;

  const { text, model } = await callAI(prompt, { isPremium: isAcademy });
  const parsed = parseJSON(text);
  return { ...parsed, _aiModel: model };
}

async function generateCaption({ painCategory = 'general', platform = 'facebook', pillar = 'pain_point', contentStyle = null, objective = null, liveSignals = [] }) {
  const isAcademy = pillar === 'academy' || pillar === 'growth_os';
  let categoryContext = ACADEMY_CATEGORY_CONTEXT[painCategory] || painPointService.buildCategoryContext(painCategory);

  const styleNote = contentStyle && STYLE_PROMPTS[contentStyle] ? STYLE_PROMPTS[contentStyle] : '';
  const objectiveNote = objective && OBJECTIVE_PROMPTS[objective] ? OBJECTIVE_PROMPTS[objective] : '';
  const isFacebook = platform === 'facebook';
  const liveSignalsBlock = buildLiveSignalsBlock(liveSignals);

  const prompt = `Generate a ${isFacebook ? 'full educational Facebook post' : 'short caption'} for Micahskin.

CATEGORY CONTEXT:
${categoryContext}
${liveSignalsBlock}

Platform: ${isFacebook ? 'Facebook — Educational storytelling, 150–250 words. Nigerian women 25–45. Community-feel, not salesy.' : 'Short caption — 30–50 words. Hook-focused. Instagram or Twitter style.'}
Pillar: ${pillar}
${styleNote}
${objectiveNote}

Return ONLY valid JSON:
{
  "content_title": "Post title under 10 words",
  "target_audience": "Nigerian women [age] dealing with [exact pain or goal]",
  "hook": "Opening line that immediately stops the scroll.",
  ${isFacebook ? `"educational_post": {
    "intro": "Opening paragraph (2–3 sentences). Hook + problem setup.",
    "body_paragraphs": [
      "Paragraph 2: Deeper validation of the pain or challenge.",
      "Paragraph 3: The insight — what most people get wrong.",
      "Paragraph 4: How Micahskin approaches this differently."
    ],
    "conclusion": "Closing paragraph (1–2 sentences). Soft but clear invitation."
  },` : ''}
  "caption": "Full formatted post text with natural line breaks. 2–3 natural emojis. Ready to paste.",
  "cta": "Primary call to action pointing to bio link — warm, natural, platform-native. Under 12 words.",
  "bio_cta": "Natural bio reference — feels like a friend recommending something. No hard sell.",
  "hashtags": ["#micahskin", "#nigerianwomen", "#africanskincare", "#skincarenigeria"],
  "posting_angle": "Why this post will resonate and drive action.",
  "academy_cta": ${isAcademy ? '"Join Micahskin Academy — build your skincare brand with AI growth systems (₦50k–₦60k). Link in bio."' : 'null'},
  "growth_os_cta": ${pillar === 'growth_os' ? '"Get the full Growth OS — the complete system for scaling your skincare brand. Link in bio."' : 'null'}
}`;

  const { text, model } = await callAI(prompt, { isPremium: isAcademy });
  const parsed = parseJSON(text);
  return { ...parsed, _aiModel: model };
}

async function generateCarousel({ painCategory = 'general', platform = 'instagram_reel', pillar = 'pain_point', slideCount = 5, contentStyle = null, objective = null, liveSignals = [] }) {
  const isAcademy = pillar === 'academy' || pillar === 'growth_os';
  let categoryContext = ACADEMY_CATEGORY_CONTEXT[painCategory] || painPointService.buildCategoryContext(painCategory);

  const styleNote = contentStyle && STYLE_PROMPTS[contentStyle] ? STYLE_PROMPTS[contentStyle] : '';
  const objectiveNote = objective && OBJECTIVE_PROMPTS[objective] ? OBJECTIVE_PROMPTS[objective] : '';
  const liveSignalsBlock = buildLiveSignalsBlock(liveSignals);

  const prompt = `Generate a ${slideCount}-slide carousel for Micahskin on ${platform}.

CATEGORY CONTEXT:
${categoryContext}
${liveSignalsBlock}

Pillar: ${pillar}
${styleNote}
${objectiveNote}
Target: Nigerian women 18–45. Each slide: complete visual unit, mobile-readable. Heading max 10 words. Body max 30 words.

Return ONLY valid JSON:
{
  "content_title": "Carousel series title under 10 words",
  "target_audience": "Nigerian women [age] dealing with [exact pain or goal]",
  "hook_slide": {
    "heading": "The slide headline that stops scrolling",
    "body": "1–2 sentences of compelling emotional context"
  },
  "problem_slides": [
    {"slide_number": 2, "heading": "Problem validation heading", "body": "Validates their pain specifically"},
    {"slide_number": 3, "heading": "Agitation heading", "body": "Makes the problem feel urgent to solve"}
  ],
  "solution_slides": [
    {"slide_number": 4, "heading": "Solution approach", "body": "How Micahskin addresses this"},
    {"slide_number": 5, "heading": "Transformation result", "body": "What the outcome looks like"}
  ],
  "cta_slide": {
    "heading": "Clear action heading",
    "body": "CTA with warm Nigerian tone",
    "cta_text": "Exact action text"
  },
  "caption": "Full post caption ready to paste — hook + context + CTA.",
  "cta": "Primary CTA text — natural bio reference, platform-native, warm and direct.",
  "bio_cta": "Short bio reference for the caption. Under 10 words.",
  "hashtags": ["#micahskin", "#nigerianwomen", "#africanskincare", "#skincarenigeria"],
  "posting_angle": "Why this carousel will convert Nigerian viewers on ${platform}."
}`;

  const { text, model } = await callAI(prompt, { isPremium: isAcademy });
  const parsed = parseJSON(text);
  return { ...parsed, _aiModel: model };
}

async function generateHookVariants({ painCategory = 'general', platform = 'tiktok', pillar = 'pain_point', count = 5 }) {
  let categoryContext = ACADEMY_CATEGORY_CONTEXT[painCategory] || painPointService.buildCategoryContext(painCategory);

  const prompt = `Generate ${count} different high-performing hooks for Micahskin on ${platform} about the topic below.

CATEGORY CONTEXT:
${categoryContext}

Pillar: ${pillar}
Each hook: under 12 words, spokenable, uses a different framework (question/statement/shock/story/contrarian/benefit), specific to Nigerian audience, not generic.

Return ONLY valid JSON:
{
  "hooks": [
    {
      "text": "Hook text",
      "framework": "question|statement|shock|story|contrarian|benefit",
      "platform": "${platform}",
      "pillar": "${pillar}"
    }
  ]
}`;

  const { text, model } = await callAI(prompt, { isPremium: false });
  return parseJSON(text);
}

async function generatePlatformCTA({ platform = 'tiktok', funnelTarget = 'telegram', painCategory = 'general' }) {
  const prompt = `Generate 3 platform-specific CTA variants for Micahskin on ${platform} pointing to ${funnelTarget}.

Context: ${painCategory} topic, Nigerian audience.
Each CTA: max 12 words, Nigerian voice, different framings (curiosity / urgency / benefit).

Return ONLY valid JSON:
{
  "cta_variants": [
    {"text": "CTA text", "tone": "urgency|curiosity|benefit", "spokenForm": "How you'd naturally say it aloud"}
  ],
  "primary_cta": "The strongest one for this audience and platform"
}`;

  const { text } = await callAI(prompt, { isPremium: false });
  return parseJSON(text);
}

async function localizeWithNaijaTone(content, { platform = 'tiktok', urgency = 'medium' } = {}) {
  const prompt = `Add Nigerian authenticity to this skincare content. DO NOT rewrite — only inject 1–2 Naija expressions where they naturally fit.

Original:
"${content}"

Natural additions (use max 2): "abeg", "e don do", "no cap", "wahala", "it's giving...", "you go thank yourself", "chai", "sis"
Platform: ${platform} | Urgency: ${urgency}

Return ONLY the modified text (no JSON, no explanation).`;

  const { text } = await callAI(prompt, { isPremium: false });
  return text.trim();
}

module.exports = {
  generateShortFormScript,
  generateWhatsAppStatus,
  generateCaption,
  generateCarousel,
  generateHookVariants,
  generatePlatformCTA,
  localizeWithNaijaTone,
  PROVIDER,
};
