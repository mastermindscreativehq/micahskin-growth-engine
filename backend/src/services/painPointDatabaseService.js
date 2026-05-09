// Pain Point Database Service
// Hardcoded catalog of Nigerian/African skincare pain points
// Organized by category with emotional language and buying signals

const PAIN_CATEGORIES = {
  acne: {
    label: 'Acne & Breakouts',
    painPoints: [
      'Why is my face still covered in spots?',
      'Every time my period comes, my face breaks out',
      'My acne scars are making me look older than I am',
      'Nothing works on my stubborn body acne',
      'I\'ve tried everything and my face is still angry',
    ],
    emotionalTriggers: [
      'scarred for life',
      'tired of hiding',
      'no confidence',
      'picture day fears',
      'relationship insecurity',
    ],
    agitators: ['stress', 'bad diet', 'sleeping with makeup', 'humidity', 'wrong products'],
    audienceSignals: ['cosmetic damage', 'low confidence', 'teenager to young adult', 'body image'],
  },

  hyperpigmentation: {
    label: 'Hyperpigmentation & Dark Spots',
    painPoints: [
      'My face looks uneven and patchy',
      'These dark marks are ageing me 10 years',
      'I\'m darker on my face than my neck',
      'My cheeks have permanent brown spots',
      'Why is my forehead so much darker?',
    ],
    emotionalTriggers: [
      'aging faster',
      'uneven beauty',
      'sun damage regret',
      'permanent staining',
      'self-conscious makeup heavy',
    ],
    agitators: ['sun exposure', 'acne scars', 'pregnancy', 'poor skincare', 'genetics'],
    audienceSignals: ['sun exposure', 'maturity concerns', 'outdoor workers', 'entrepreneurs'],
  },

  dark_spots: {
    label: 'Dark Spots & Blemishes',
    painPoints: [
      'My face has more spots than my mum\'s',
      'These dark marks won\'t fade',
      'Am I going to look like this forever?',
      'My forehead is darker than my face',
      'Dark knuckles making me self-conscious',
    ],
    emotionalTriggers: [
      'premature aging',
      'social anxiety',
      'family comparison',
      'permanent damage fear',
      'visible inequality',
    ],
    agitators: ['sun damage', 'inflammation', 'picking scars', 'sun protection neglect', 'age'],
    audienceSignals: ['sun exposure', 'workers outdoors', 'scar history', 'age-conscious'],
  },

  oily_skin: {
    label: 'Oily Skin & Shine',
    painPoints: [
      'My face is oily by 10am',
      'My makeup never stays — it just slides off',
      'Shine on my T-zone is ruining my photos',
      'Why do I have to powder my face every hour?',
      'Oil + humidity = disaster for me',
    ],
    emotionalTriggers: [
      'makeup embarrassment',
      'constant touch-ups',
      'photo anxiety',
      'feeling greasy',
      'lack of control',
    ],
    agitators: ['heat', 'humidity', 'wrong skincare', 'not cleansing properly', 'genetics'],
    audienceSignals: ['hot climate dwellers', 'makeup wearers', 'social media active', 'outdoor workers'],
  },

  stretch_marks: {
    label: 'Stretch Marks',
    painPoints: [
      'My stretch marks are so dark and visible',
      'Pregnancy changed my body and I hate it',
      'I can\'t wear certain clothes because of these marks',
      'My thighs and belly are covered — when will they fade?',
      'These marks make me feel less attractive',
    ],
    emotionalTriggers: [
      'body insecurity',
      'post-pregnancy regret',
      'hiding in clothes',
      'relationship anxiety',
      'youth loss',
    ],
    agitators: ['rapid weight gain', 'pregnancy', 'puberty', 'genetics', 'lack of moisturizing'],
    audienceSignals: ['post-pregnancy', 'weight gain phases', 'entrepreneurs earning/gaining confidence', 'younger demographic'],
  },

  uneven_tone: {
    label: 'Uneven Skin Tone',
    painPoints: [
      'My face is 5 different shades',
      'I look like I have a mask on',
      'The discolouration is ruining my natural glow',
      'Redness on my cheeks won\'t go away',
      'My skin looks patchy and blotchy',
    ],
    emotionalTriggers: [
      'mask-like appearance',
      'unnatural look',
      'makeup heavy',
      'self-consciousness',
      'unpolished feeling',
    ],
    agitators: ['rosacea', 'inflammation', 'sun damage', 'poor products', 'genetics', 'hormones'],
    audienceSignals: ['sensitive skin history', 'makeup wearers', 'self-presenters', 'detail-oriented'],
  },

  dry_skin: {
    label: 'Dry & Dehydrated Skin',
    painPoints: [
      'My skin is so tight and uncomfortable',
      'No matter what I use, I\'m still flaky',
      'My makeup doesn\'t sit right because of dry patches',
      'My skin feels like paper',
      'I\'m constantly itchy',
    ],
    emotionalTriggers: [
      'discomfort',
      'makeup frustration',
      'visibly damaged',
      'painful tightness',
      'itchy anxiety',
    ],
    agitators: ['climate', 'harsh products', 'over-stripping', 'not moisturizing', 'weather change'],
    audienceSignals: ['climate sensitive', 'product reactivity', 'sensitive skin', 'year-round concerns'],
  },

  sensitive: {
    label: 'Sensitive Skin',
    painPoints: [
      'My skin reacts to everything',
      'I can\'t even use water without it burning',
      'Any new product causes a rash',
      'My skin is angry and inflamed all the time',
      'I\'m afraid to try anything new',
    ],
    emotionalTriggers: [
      'fear of products',
      'reactivity anxiety',
      'limited choices',
      'painful sensations',
      'medical concerns',
    ],
    agitators: ['harsh products', 'fragrance', 'allergens', 'climate', 'stress', 'hormones'],
    audienceSignals: ['reactive history', 'allergy prone', 'cautious buyer', 'medical-conscious', 'health-focused'],
  },

  general: {
    label: 'General Skincare',
    painPoints: [
      'I don\'t know where to start with skincare',
      'My skin just feels off — tired and dull',
      'I want clear, glowing skin but don\'t know how',
      'My skin looks dead and lifeless',
      'I\'m spending so much on products that don\'t work',
    ],
    emotionalTriggers: [
      'confusion',
      'wasted money',
      'hopelessness',
      'lack of direction',
      'tired appearance',
    ],
    agitators: ['wrong routine', 'inconsistency', 'bad information', 'no professional guidance', 'wrong products'],
    audienceSignals: ['beginner', 'information seeker', 'bargain conscious', 'education hungry', 'routine builder'],
  },
};

// Hook types: question, statement, shock, story, contrarian
const HOOK_FRAMEWORKS = {
  question: [
    'Does your face look like...?',
    'Why is your...?',
    'How many of these do you have...?',
    'What if I told you...?',
  ],
  statement: [
    'Most people don\'t know...',
    'Here\'s what nobody tells you...',
    'The real reason your... is...',
    'This is how we...',
  ],
  shock: [
    'This will shock you...',
    'I can\'t believe...',
    'This changes everything...',
    'You won\'t believe what causes...',
  ],
  story: [
    'This girl went from... to...',
    'I was just like you...',
    'Her biggest regret was...',
    'The story behind her transformation...',
  ],
  contrarian: [
    'Everything you know about... is wrong',
    'Stop doing this to your skin...',
    'Your dermatologist won\'t tell you...',
    'Forget everything you\'ve been told...',
  ],
};

const Prisma = require('@prisma/client');
const prisma = new Prisma.PrismaClient();

const painPointService = {
  // Returns all pain categories with metadata
  getAllCategories() {
    return Object.keys(PAIN_CATEGORIES).map(key => ({
      id: key,
      label: PAIN_CATEGORIES[key].label,
      painPointCount: PAIN_CATEGORIES[key].painPoints.length,
    }));
  },

  // Returns the full pain point object for a category
  getCategoryByKey(painCategory) {
    return PAIN_CATEGORIES[painCategory] || PAIN_CATEGORIES.general;
  },

  // Returns a random pain point headline from the category
  getRandomPainPointHeadline(painCategory) {
    const cat = this.getCategoryByKey(painCategory);
    const headings = cat.painPoints;
    return headings[Math.floor(Math.random() * headings.length)];
  },

  // Returns emotional triggers for a category (context for Claude prompts)
  getEmotionalTriggers(painCategory) {
    const cat = this.getCategoryByKey(painCategory);
    return cat.emotionalTriggers;
  },

  // Returns agitators (things that make the problem worse)
  getAgitators(painCategory) {
    const cat = this.getCategoryByKey(painCategory);
    return cat.agitators;
  },

  // Returns audience buying signals
  getBuyingSignals(painCategory) {
    const cat = this.getCategoryByKey(painCategory);
    return cat.audienceSignals;
  },

  // Builds a detailed context block for Claude API prompts
  // Used in prompt caching to provide category knowledge
  buildCategoryContext(painCategory) {
    const cat = this.getCategoryByKey(painCategory);
    const signals = cat.audienceSignals || [];

    return `
PAIN CATEGORY: ${cat.label.toUpperCase()}

Sample Pain Points (use these as inspiration, not templates):
${cat.painPoints.map(p => `- ${p}`).join('\n')}

Emotional Triggers (what makes people stop scrolling):
${cat.emotionalTriggers.map(e => `- ${e}`).join('\n')}

What Makes It Worse (agitators):
${cat.agitators.map(a => `- ${a}`).join('\n')}

Target Audience Buying Signals:
${signals.map(s => `- ${s}`).join('\n')}

Remember: Nigerian women in this category are looking for REAL solutions, not generic advice.
Speak to their specific pain, validate their frustration, and show how Micahskin solves it.
`;
  },

  // Returns hook frameworks for different viral hook types
  getHookFrameworks() {
    return HOOK_FRAMEWORKS;
  },

  // Builds a context block for hook generation
  buildHookContext(painCategory) {
    const frameworks = HOOK_FRAMEWORKS;
    return `
HOOK GENERATION CONTEXT FOR: ${PAIN_CATEGORIES[painCategory]?.label || 'General Skincare'}

Available Viral Hook Frameworks:
${Object.entries(frameworks)
  .map(
    ([type, frames]) => `
${type.toUpperCase()} HOOKS:
${frames.map(f => `- "${f}"`).join('\n')}
`
  )
  .join('\n')}

Generate hooks that are:
- Specific to the Nigerian audience
- Emotionally resonant with the pain
- Short enough to read in 2 seconds
- Platform-appropriate (TikTok hooks are punchier, WhatsApp can be longer)
- Contain no emojis (add later if needed)
`;
  },
};

module.exports = painPointService;
