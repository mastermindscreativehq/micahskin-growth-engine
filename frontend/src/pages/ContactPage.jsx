export default function ContactPage() {
  return (
    <div className="bg-cream-50 py-16 px-6">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-brand-500 text-sm font-semibold uppercase tracking-widest mb-3">
            Get in touch
          </p>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Contact MICAHSKIN</h1>
          <p className="text-gray-500 leading-relaxed">
            Whether you have a question about skincare, the Academy, or anything else —
            we'd love to hear from you.
          </p>
        </div>

        {/* Contact cards */}
        <div className="grid gap-6 sm:grid-cols-2">

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center">
              <span className="text-brand-600 text-lg">✉</span>
            </div>
            <h2 className="font-semibold text-gray-800">Email</h2>
            <p className="text-sm text-gray-500">
              Send us an email and we'll reply within 1–2 business days.
            </p>
            <a
              href="mailto:micahskin4u@gmail.com"
              className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors mt-auto"
            >
              micahskin4u@gmail.com
            </a>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center">
              <span className="text-brand-600 text-lg">💬</span>
            </div>
            <h2 className="font-semibold text-gray-800">WhatsApp &amp; Messaging</h2>
            <p className="text-sm text-gray-500">
              Submit an enquiry via our home page and we'll follow up directly on WhatsApp
              or your preferred channel.
            </p>
            <a
              href="/"
              className="text-sm font-medium text-brand-600 hover:text-brand-700 transition-colors mt-auto"
            >
              Start an enquiry →
            </a>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-3 sm:col-span-2">
            <div className="w-10 h-10 rounded-full bg-brand-50 flex items-center justify-center">
              <span className="text-brand-600 text-lg">📱</span>
            </div>
            <h2 className="font-semibold text-gray-800">Social Media</h2>
            <p className="text-sm text-gray-500">
              Follow us and send a DM on Instagram or TikTok — we're active on both.
              Mentioning where you found us helps us respond faster.
            </p>
            <div className="flex gap-4 mt-auto">
              <span className="text-sm text-gray-400">@micahskin</span>
            </div>
          </div>

        </div>

        {/* Response time note */}
        <p className="text-center text-xs text-gray-400 mt-10">
          Response times: email within 1–2 business days · WhatsApp/DM typically same day
        </p>

      </div>
    </div>
  )
}
