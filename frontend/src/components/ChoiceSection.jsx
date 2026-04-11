export default function ChoiceSection({ onChoose }) {
  return (
    <section className="px-6 py-16 bg-white">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
          How can we help you today?
        </h2>
        <p className="text-gray-500 mb-12">Choose your path below.</p>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Card 1 — Skincare */}
          <button
            onClick={() => onChoose('skincare')}
            className="group text-left border-2 border-cream-200 hover:border-brand-400 rounded-2xl p-8 transition-all duration-200 hover:shadow-lg bg-cream-50 hover:bg-brand-50 cursor-pointer"
          >
            <div className="text-4xl mb-4">✨</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-brand-700">
              Get Skincare Help
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              Struggling with acne, dark spots, hyperpigmentation, or dry skin?
              Tell us about your skin concern and we'll reach out with a personalised plan.
            </p>
            <div className="mt-6">
              <span className="inline-block bg-brand-600 text-white text-sm font-semibold px-5 py-2 rounded-lg group-hover:bg-brand-700 transition">
                Start here →
              </span>
            </div>
          </button>

          {/* Card 2 — Academy */}
          <button
            onClick={() => onChoose('academy')}
            className="group text-left border-2 border-cream-200 hover:border-brand-400 rounded-2xl p-8 transition-all duration-200 hover:shadow-lg bg-cream-50 hover:bg-brand-50 cursor-pointer"
          >
            <div className="text-4xl mb-4">🎓</div>
            <h3 className="text-xl font-bold text-gray-900 mb-2 group-hover:text-brand-700">
              Join the Academy
            </h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              Ready to build a skincare brand or grow your existing business?
              Register for the MICAHSKIN masterclass and learn proven growth systems.
            </p>
            <div className="mt-6">
              <span className="inline-block bg-brand-600 text-white text-sm font-semibold px-5 py-2 rounded-lg group-hover:bg-brand-700 transition">
                Register →
              </span>
            </div>
          </button>
        </div>
      </div>
    </section>
  )
}
