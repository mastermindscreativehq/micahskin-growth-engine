import { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AcademyForm from '../components/AcademyForm.jsx'
import SuccessMessage from '../components/SuccessMessage.jsx'
import { trackConversion } from '../api/index.js'

const PLATFORM_MAP = { instagram: 'Instagram', tiktok: 'TikTok', other: 'Other' }

function parsePrefill() {
  const params = new URLSearchParams(window.location.search)
  const rawSource = params.get('source') || ''
  return {
    leadId: params.get('leadId') || '',
    sourcePlatform: PLATFORM_MAP[rawSource.toLowerCase()] || '',
    sourceType: params.get('source_type') || '',
    handle: params.get('handle') || '',
    campaign: params.get('campaign') || '',
    intentTag: params.get('intent') || '',
    utmSource: params.get('utm_source') || '',
    utmMedium: params.get('utm_medium') || '',
    utmCampaign: params.get('utm_campaign') || '',
    utmContent: params.get('utm_content') || '',
    utmTerm: params.get('utm_term') || '',
  }
}

// ─── Section 1: Hero ─────────────────────────────────────────────────────────

function HeroSection({ onScrollToForm }) {
  return (
    <section className="bg-cream-50 px-6 py-24 text-center border-b border-cream-200">
      <div className="max-w-3xl mx-auto">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-5">
          MICAHSKIN Academy
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight mb-6">
          Master Skincare.<br />Build the Brand.<br />Grow the Business.
        </h1>
        <p className="text-lg text-gray-600 leading-relaxed mb-10 max-w-2xl mx-auto">
          The MICAHSKIN Academy combines skincare education, brand strategy, and client acquisition — in one practical system built for real business results.
        </p>
        <button
          onClick={onScrollToForm}
          className="btn-primary text-base px-10 py-4"
        >
          Secure Your Spot →
        </button>
        <p className="mt-5 text-sm text-gray-400">
          From skincare confusion to confident, scalable brand growth.
        </p>
      </div>
    </section>
  )
}

// ─── Section 2: Who This Is For ──────────────────────────────────────────────

const WHO_FOR = [
  {
    title: 'Skincare Beginners',
    desc: 'Just starting out and want to understand skin properly before selling, advising, or building a brand.',
  },
  {
    title: 'Product Sellers & Resellers',
    desc: 'You sell skincare products but want stronger knowledge and smarter recommendation skills to back it up.',
  },
  {
    title: 'Skincare Entrepreneurs',
    desc: 'Building or planning a skincare brand and need a clear, structured direction — not just ideas.',
  },
  {
    title: 'Beauty Business Owners',
    desc: 'You have a service or product line and want to grow it with better positioning and consistent client flow.',
  },
  {
    title: 'Aspiring Skin Consultants',
    desc: 'You want to advise clients on skincare with depth, confidence, and a professional framework.',
  },
  {
    title: 'Growth-Focused Founders',
    desc: 'You want better lead generation, client acquisition, and a scalable system behind your brand.',
  },
]

function WhoSection() {
  return (
    <section className="bg-white px-6 py-20 border-b border-gray-100">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-3">Who This Is For</p>
          <h2 className="text-3xl font-bold text-gray-900">
            Built for people who are serious about skincare.
          </h2>
          <p className="text-gray-500 mt-3 max-w-xl mx-auto text-sm leading-relaxed">
            Whether you are starting from zero or growing an existing brand, this programme meets you where you are.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {WHO_FOR.map((item) => (
            <div
              key={item.title}
              className="bg-cream-50 rounded-2xl p-5 border border-cream-200"
            >
              <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center mb-3">
                <span className="text-brand-600 text-xs font-bold">✦</span>
              </div>
              <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">{item.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Section 3: What They Will Learn ─────────────────────────────────────────

const LEARN_ITEMS = [
  'Understand different skin types, concerns, and how to address them with confidence',
  'Build intelligent, effective skincare routines — based on logic, not guesswork',
  'Recommend products with clear reasoning that clients can trust',
  'Think and communicate like a skin consultant when speaking to customers',
  'Position your skincare brand clearly in a competitive market',
  'Attract the right leads and convert interest into paying customers',
  'Use systems and automation to support consistent, scalable brand growth',
]

function LearnSection() {
  return (
    <section className="bg-cream-50 px-6 py-20 border-b border-cream-200">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-3">What You Will Learn</p>
          <h2 className="text-3xl font-bold text-gray-900">
            A curriculum built for application, not theory.
          </h2>
          <p className="text-gray-500 mt-3 text-sm">
            Every module connects directly to how you practice, sell, and grow.
          </p>
        </div>
        <ul className="space-y-4">
          {LEARN_ITEMS.map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span className="text-gray-700 text-sm leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ─── Section 4: What They Get ─────────────────────────────────────────────────

const GET_ITEMS = [
  {
    title: 'Academy Training Access',
    desc: 'Full masterclass content covering skincare science, routine design, product knowledge, and business positioning.',
  },
  {
    title: 'Practical Skincare Guidance',
    desc: 'Frameworks for understanding skin concerns and making confident recommendations — built on real knowledge, not assumptions.',
  },
  {
    title: 'Brand & Business Strategy',
    desc: 'How to position your brand, communicate your value clearly, and stand out in a space full of noise.',
  },
  {
    title: 'Growth Systems Thinking',
    desc: 'A structured approach to scaling your brand so your growth is intentional and repeatable — not accidental.',
  },
  {
    title: 'Lead Generation Framework',
    desc: 'Practical guidance on attracting clients and building a steady, qualified pipeline for your skincare business.',
  },
  {
    title: 'Priority Support (Premium)',
    desc: 'Premium members receive priority access to follow-up guidance and direct support throughout the programme.',
  },
]

function GetSection() {
  return (
    <section className="bg-white px-6 py-20 border-b border-gray-100">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-3">What You Get</p>
          <h2 className="text-3xl font-bold text-gray-900">
            Everything you need to go from learning to earning.
          </h2>
          <p className="text-gray-500 mt-3 text-sm max-w-xl mx-auto">
            This is not a passive learning experience. It is a system for moving forward.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {GET_ITEMS.map((item) => (
            <div
              key={item.title}
              className="border border-gray-100 rounded-2xl p-5 bg-cream-50"
            >
              <h3 className="font-semibold text-gray-900 mb-1.5 text-sm">{item.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Section 5: Transformation ────────────────────────────────────────────────

const BEFORE = [
  'Confused about skin types and what products actually do',
  'Giving generic advice with no real foundation behind it',
  'No clear direction for your brand or what makes it different',
  'Struggling to attract and convert the right customers',
  'Working without a system — reactive, not strategic',
]

const AFTER = [
  'Clear, confident understanding of skin concerns and care',
  'Recommending with logic — and clients who trust you for it',
  'A sharper brand identity and stronger market position',
  'A structured approach to lead generation and client flow',
  'A growth system working consistently behind your brand',
]

function TransformationSection() {
  return (
    <section className="bg-cream-50 px-6 py-20 border-b border-cream-200">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-3">The Transformation</p>
          <h2 className="text-3xl font-bold text-gray-900">
            Where you are now — and where you are going.
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl p-6 border border-gray-100">
            <p className="text-xs font-semibold text-gray-300 uppercase tracking-widest mb-5">Before</p>
            <ul className="space-y-4">
              {BEFORE.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-gray-500">
                  <span className="mt-0.5 text-gray-300 flex-shrink-0 font-medium">✕</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-brand-600 rounded-2xl p-6">
            <p className="text-xs font-semibold text-brand-300 uppercase tracking-widest mb-5">After</p>
            <ul className="space-y-4">
              {AFTER.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-white">
                  <span className="mt-0.5 text-brand-300 flex-shrink-0 font-medium">✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Section 6: Trust / Why Different ────────────────────────────────────────

const DIFF_ITEMS = [
  {
    title: 'Skincare knowledge meets business strategy',
    desc: 'Most programmes teach one or the other. This one connects skin science to brand growth — because the best practitioners understand both.',
  },
  {
    title: 'Practical, not generic',
    desc: 'Content is built for real application. You will leave with frameworks you can use in your business — not theory that sits unused.',
  },
  {
    title: 'Designed for implementation',
    desc: 'The programme does not stop at education. It moves students from learning to doing — with structured frameworks and clear next steps.',
  },
  {
    title: 'Built for real business application',
    desc: 'The focus is on what actually works: understanding your customer, positioning your brand, and building systems that sustain growth.',
  },
]

function TrustSection() {
  return (
    <section className="bg-white px-6 py-20 border-b border-gray-100">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-3">Why MICAHSKIN Academy</p>
          <h2 className="text-3xl font-bold text-gray-900">Not just another skincare course.</h2>
          <p className="text-gray-500 mt-3 max-w-xl mx-auto text-sm">
            Here is what sets this apart.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {DIFF_ITEMS.map((item) => (
            <div
              key={item.title}
              className="bg-cream-50 rounded-2xl p-5 border border-cream-200"
            >
              <h3 className="font-semibold text-gray-900 mb-2 text-sm">{item.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Section 7: Pre-Form CTA ──────────────────────────────────────────────────

function PreFormCTA({ onScrollToForm }) {
  return (
    <section className="bg-brand-600 px-6 py-20 text-center">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold text-white mb-4">
          Ready to build something real?
        </h2>
        <p className="text-brand-200 mb-8 text-base leading-relaxed max-w-lg mx-auto">
          Register for the MICAHSKIN Academy and get access to skincare education, brand strategy, and a practical growth system — in one programme.
        </p>
        <button
          onClick={onScrollToForm}
          className="bg-white text-brand-700 font-semibold py-3 px-10 rounded-xl hover:bg-cream-50 transition-all duration-200 shadow-md active:scale-95"
        >
          Register Now →
        </button>
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AcademyPage() {
  const navigate = useNavigate()
  const [done, setDone] = useState(false)
  const [prefill] = useState(parsePrefill)
  const formRef = useRef(null)

  const scrollToForm = useCallback(() => {
    formRef.current?.scrollIntoView({ behavior: 'smooth' })
    if (prefill.leadId) {
      trackConversion(prefill.leadId, 'academy_click')
    }
  }, [prefill.leadId])

  if (done) {
    return <SuccessMessage type="academy" onReset={() => navigate('/')} />
  }

  return (
    <div>
      <HeroSection onScrollToForm={scrollToForm} />
      <WhoSection />
      <LearnSection />
      <GetSection />
      <TransformationSection />
      <TrustSection />
      <PreFormCTA onScrollToForm={scrollToForm} />

      {/* Registration form */}
      <section
        ref={formRef}
        id="register"
        className="bg-cream-50 px-6 pt-16 pb-20 border-t border-cream-200"
      >
        <div className="max-w-lg mx-auto mb-10 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600 mb-2">Register</p>
          <h2 className="text-2xl font-bold text-gray-900">Join the MICAHSKIN Academy</h2>
          <p className="text-gray-500 text-sm mt-2 leading-relaxed">
            Fill in your details below. You will choose your package after registration.
          </p>
        </div>
        <AcademyForm
          prefill={prefill}
          leadId={prefill.leadId || null}
          onSuccess={() => setDone(true)}
          onBack={() => navigate('/')}
          embedded
        />
      </section>
    </div>
  )
}
