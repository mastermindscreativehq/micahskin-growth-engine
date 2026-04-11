export default function SuccessMessage({ type, onReset }) {
  const isSkincare = type === 'skincare'

  return (
    <section className="min-h-screen flex items-center justify-center px-6 bg-gradient-to-br from-brand-50 to-cream-100">
      <div className="max-w-md w-full text-center bg-white rounded-2xl shadow-lg px-8 py-12">
        <div className="text-5xl mb-5">{isSkincare ? '🌿' : '🎉'}</div>

        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          {isSkincare ? "We've received your details!" : "You're registered!"}
        </h2>

        <p className="text-gray-500 text-sm leading-relaxed mb-8">
          {isSkincare
            ? 'Thank you for reaching out. A member of the MICAHSKIN team will be in touch with you shortly via WhatsApp or email.'
            : "Welcome to the MICAHSKIN Academy! We'll be in touch with everything you need to know about the masterclass."}
        </p>

        <button onClick={onReset} className="btn-secondary">
          Back to home
        </button>
      </div>
    </section>
  )
}
