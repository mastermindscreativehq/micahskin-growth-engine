export default function Hero() {
  return (
    <section className="bg-gradient-to-br from-brand-50 via-cream-100 to-cream-200 px-6 py-20 text-center">
      <div className="max-w-2xl mx-auto">
        {/* Brand mark */}
        <p className="text-brand-500 text-sm font-semibold uppercase tracking-widest mb-4">
          Welcome to
        </p>

        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-4 leading-tight">
          MICAHSKIN
        </h1>

        <p className="text-lg md:text-xl text-gray-600 mb-6 leading-relaxed">
          Transforming skin — and the brands that care for it.
        </p>

        <p className="text-base text-gray-500 max-w-lg mx-auto leading-relaxed">
          Whether you're on a journey to clearer, glowing skin or you're ready to build
          a skincare business that lasts — you're in the right place.
        </p>

        {/* Decorative divider */}
        <div className="mt-10 flex items-center justify-center gap-3">
          <div className="h-px w-12 bg-brand-300"></div>
          <div className="w-2 h-2 rounded-full bg-brand-400"></div>
          <div className="h-px w-12 bg-brand-300"></div>
        </div>
      </div>
    </section>
  )
}
