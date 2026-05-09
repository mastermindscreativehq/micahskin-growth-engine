// Comment Intelligence Service
// AI-powered analysis of raw audience text to extract psychological signals.
// Uses GPT-4.1-mini for fast, cost-efficient structured extraction.

const OpenAI = require('openai');

let _openai = null;
function openai() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const ANALYSIS_SYSTEM_PROMPT = `You are a market intelligence AI specializing in Nigerian skincare and beauty audience psychology.

Your role: analyze social media comments, messages, or conversations and extract structured psychological intelligence that can be used to create better content and understand audience needs.

EXTRACT VERBATIM or near-verbatim phrases — do not paraphrase or summarize. The goal is to capture the EXACT language the audience uses.

Extract these 9 categories:
1. painPoints — specific skin problems mentioned (e.g., "my face breaks out every month")
2. emotionalLanguage — charged emotional phrases (e.g., "I'm so embarrassed", "I've tried everything")
3. frustrations — what they're fed up with (e.g., "products that don't work", "wasted so much money")
4. objections — doubts or hesitations (e.g., "how do I know it's real", "too expensive for me")
5. desires — what they want or hope for (e.g., "clear skin by December", "I just want to feel confident")
6. urgencySignals — phrases showing time pressure (e.g., "my wedding is in 3 weeks", "I need this now")
7. trustIssues — authenticity or scam concerns (e.g., "is this legit", "tired of fake products")
8. slang — Nigerian/African/internet slang used (e.g., "e don do", "abeg", "no cap", "e don do me")
9. repeatedQuestions — questions they're asking (e.g., "does this work for dark skin?")

Then SCORE (0-100):
- emotionalIntensity: how emotionally charged is this text?
- conversionPotential: how ready is this person to buy something?
- viralityPotential: how relatable/viral would this language be in content?

CLASSIFY:
- primarySignalType: dominant signal (pain_point | frustration | objection | desire | question | intent | neutral)
- audienceSegment: who is this? (consumer | entrepreneur | brand_builder | unknown)
- nicheCategory: skin concern (acne | hyperpigmentation | dark_spots | oily_skin | stretch_marks | uneven_tone | dry_skin | sensitive | knuckle_darkening | academy | general)
- buyingIntentDetected: true if they show clear purchase signals

IMPORTANT: Return ONLY valid JSON. No extra text.`;

const ANALYSIS_SCHEMA = `{
  "painPoints": [],
  "emotionalLanguage": [],
  "frustrations": [],
  "objections": [],
  "desires": [],
  "urgencySignals": [],
  "trustIssues": [],
  "slang": [],
  "repeatedQuestions": [],
  "buyingIntentDetected": false,
  "emotionalIntensity": 0,
  "conversionPotential": 0,
  "viralityPotential": 0,
  "primarySignalType": "neutral",
  "audienceSegment": "consumer",
  "nicheCategory": "general",
  "aiSummary": "One sentence core insight."
}`;

async function analyzeText(rawText, source = 'manual') {
  if (!rawText || rawText.trim().length < 5) {
    throw new Error('Text too short to analyze');
  }

  const client = openai();
  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `SOURCE: ${source}\n\nTEXT TO ANALYZE:\n${rawText.substring(0, 3000)}\n\nReturn JSON matching this schema:\n${ANALYSIS_SCHEMA}`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 1200,
  });

  const raw = response.choices[0].message.content;
  const result = JSON.parse(raw);

  // Ensure all array fields exist and are arrays
  const arrayFields = ['painPoints', 'emotionalLanguage', 'frustrations', 'objections', 'desires', 'urgencySignals', 'trustIssues', 'slang', 'repeatedQuestions'];
  for (const field of arrayFields) {
    if (!Array.isArray(result[field])) result[field] = [];
  }

  // Clamp scores 0-100
  for (const scoreField of ['emotionalIntensity', 'conversionPotential', 'viralityPotential']) {
    result[scoreField] = Math.min(100, Math.max(0, Number(result[scoreField]) || 0));
  }

  return result;
}

module.exports = { analyzeText };
