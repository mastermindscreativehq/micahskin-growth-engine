'use strict'

/**
 * Academy lesson catalogue — shared between academyExperienceService and
 * academyOperatorService so both can send the same lesson content.
 */
const LESSONS = [
  {
    number: 1,
    title: 'Brand Vision & Your Why',
    unlockDelayHours: 0,
    ctaAfter: null,
    message: (firstName) =>
      `🌿 <b>Lesson 1 of 5 — Brand Vision & Your Why</b>\n\n` +
      `Welcome to your first lesson, ${firstName}.\n\n` +
      `Every great skincare brand starts with a clear <b>why</b>.\n\n` +
      `Before formulas, products, or packaging — you need clarity on three things:\n` +
      `→ <b>Who</b> are you building this for?\n` +
      `→ <b>What</b> specific skin problem are you solving?\n` +
      `→ <b>Why</b> are you the right person to solve it?\n\n` +
      `The most successful skincare brands are built around specific niches and personal stories. Not "for everyone". For <i>someone</i>.\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Complete this sentence:\n` +
      `<i>"I'm building [Brand Name] for [Target Person] who struggles with [Skin Problem] because [My Why]."</i>\n\n` +
      `Write it down — we'll build your entire brand around this in the lessons ahead.\n\n` +
      `Reply with your answer or just <b>Done</b> when you're ready to continue. 👇`,
  },
  {
    number: 2,
    title: 'Understanding Skin & Your Hero Product',
    unlockDelayHours: 24,
    ctaAfter: 'product_offer',
    message: (firstName) =>
      `🔬 <b>Lesson 2 of 5 — Understanding Skin & Your Hero Product</b>\n\n` +
      `Good work on Lesson 1, ${firstName}.\n\n` +
      `Now let's talk skin science — not the complex textbook version, but what you <i>actually</i> need to know to create effective products.\n\n` +
      `<b>The 4 core skin concerns you should build around:</b>\n` +
      `1. Acne & breakouts (excess oil, bacteria, clogged pores)\n` +
      `2. Hyperpigmentation & dark spots (melanin overproduction)\n` +
      `3. Dryness & dehydration (barrier damage, lack of moisture)\n` +
      `4. Uneven texture & dullness (dead skin buildup, slow cell turnover)\n\n` +
      `<b>Why does this matter?</b>\n` +
      `Your hero product must target ONE of these clearly. Not all four. One.\n\n` +
      `This focus is what makes brands like The Ordinary, Naturium, and MICAHSKIN cut through the noise.\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Pick one skin concern from the list above.\n` +
      `Then answer: "My hero product will help [Target Person] with [Problem] by [What it does]."\n\n` +
      `Reply with your answer when you're done. Lesson 3 will cover how to actually build that product. 👇`,
  },
  {
    number: 3,
    title: 'Product Development: Formulation & Sourcing',
    unlockDelayHours: 24,
    ctaAfter: null,
    message: (firstName) =>
      `⚗️ <b>Lesson 3 of 5 — Product Development: Formulation & Sourcing</b>\n\n` +
      `You have your niche and your hero product idea. Now, how do you actually build it?\n\n` +
      `<b>The 3 routes to formulation:</b>\n\n` +
      `<b>1. White-label (fastest, low cost)</b>\n` +
      `Work with a manufacturer who has existing formulas. You choose the base, add your branding. Great for starting fast.\n\n` +
      `<b>2. Custom formulation (most differentiated)</b>\n` +
      `Work with a cosmetic chemist or formulation lab to create a proprietary product. Higher cost, higher brand value.\n\n` +
      `<b>3. DIY formulation (most risky, not recommended)</b>\n` +
      `Only if you have chemistry training. Unformulated products can harm skin and create serious liability.\n\n` +
      `<b>Key sourcing principles:</b>\n` +
      `→ Always request Safety Data Sheets (SDS) and Certificates of Analysis (COA) from suppliers\n` +
      `→ Start with small batches (50–100 units) to test market response before scaling\n` +
      `→ NAFDAC registration is required in Nigeria before you can legally sell skincare\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Research one formulation lab or white-label manufacturer in your region.\n` +
      `Write down their name, what they offer, and a contact point.\n\n` +
      `Reply when you've done it — Lesson 4 covers brand identity. 👇`,
  },
  {
    number: 4,
    title: 'Brand Identity & Packaging',
    unlockDelayHours: 24,
    ctaAfter: 'consult_offer',
    message: (firstName) =>
      `✨ <b>Lesson 4 of 5 — Brand Identity & Packaging</b>\n\n` +
      `${firstName}, this is where your brand comes to life.\n\n` +
      `Your brand identity is everything your customer sees, feels, and remembers before they even try the product.\n\n` +
      `<b>Your brand identity checklist:</b>\n` +
      `□ Brand name — memorable, easy to pronounce, available on IG/TikTok\n` +
      `□ Colour palette — 2–3 colours that reflect your brand personality\n` +
      `□ Typography — 1 headline font, 1 body font\n` +
      `□ Tone of voice — clinical? warm? empowering? playful?\n` +
      `□ Logo — simple, scalable, works on packaging AND phone screen\n\n` +
      `<b>Packaging principles:</b>\n` +
      `→ Packaging must match your price point (cheap packaging = low perceived value)\n` +
      `→ Airless pumps for serums, glass for premium, tubes for treatments\n` +
      `→ Your packaging IS your first impression on the shelf and in unboxing videos\n\n` +
      `<b>Common mistake to avoid:</b>\n` +
      `Don't spend months on branding before you've validated your product. Build a clean MVP brand that can evolve.\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Write your brand name, your 3 brand colours (hex codes or descriptions), and your brand voice in 3 words.\n\n` +
      `Reply when done — your final lesson is next. 👇`,
  },
  {
    number: 5,
    title: 'Sales, Launches & Growing Your Brand',
    unlockDelayHours: 24,
    ctaAfter: 'graduate_offer',
    message: (firstName) =>
      `🚀 <b>Lesson 5 of 5 — Sales, Launches & Growing Your Brand</b>\n\n` +
      `${firstName}, this is the final lesson — and it's the most important.\n\n` +
      `A great product with no sales strategy goes nowhere. Let's fix that.\n\n` +
      `<b>The 3-phase launch framework:</b>\n\n` +
      `<b>Phase 1: Pre-launch (2–4 weeks before)</b>\n` +
      `→ Build social proof by sharing your product journey on IG/TikTok\n` +
      `→ Create a waitlist (Google Form or WhatsApp broadcast)\n` +
      `→ Reach out to 10 micro-influencers in your niche for gifted collaborations\n\n` +
      `<b>Phase 2: Launch week</b>\n` +
      `→ Email + WhatsApp blast to your waitlist\n` +
      `→ Daily content for 7 days: before/after, ingredients, testimonials\n` +
      `→ Launch offer: bundle, discount, or limited-run packaging\n\n` +
      `<b>Phase 3: Post-launch (ongoing)</b>\n` +
      `→ Collect reviews and testimonials immediately (send a template to first buyers)\n` +
      `→ Identify your best customers and build a loyalty system\n` +
      `→ Use real feedback to improve formulation or packaging on your next batch\n\n` +
      `<b>DM script that works:</b>\n` +
      `<i>"Hi [Name], I launched a skincare solution specifically for [Problem]. I'd love for you to be one of the first to try it — I'm offering [Offer] this week only. Would you like the details?"</i>\n\n` +
      `🎯 <b>Your action step:</b>\n` +
      `Map out your launch date and the 3 things you'll do in your pre-launch phase.\n\n` +
      `Reply when you're done — I have something special for you. 🌿`,
  },
]

const TOTAL_LESSONS = LESSONS.length

module.exports = { LESSONS, TOTAL_LESSONS }
