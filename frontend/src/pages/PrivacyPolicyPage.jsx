export default function PrivacyPolicyPage() {
  return (
    <div className="bg-cream-50 py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-400 mb-10">Effective date: January 1, 2025</p>

        <div className="space-y-10 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">1. Who We Are</h2>
            <p>
              MICAHSKIN ("we", "us", or "our") provides personalised skincare consultation services
              and professional skincare business education through our academy programme. This Privacy
              Policy explains how we collect, use, and protect your personal information when you
              interact with our website, lead forms, or messaging channels.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">2. Information We Collect</h2>
            <p className="mb-3">We collect information you provide directly to us, including:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Identity &amp; contact data:</strong> full name, email address, and phone number.</li>
              <li><strong>Skin &amp; health data:</strong> skin concerns you describe (e.g. acne, hyperpigmentation, dry skin) and any additional details you share in your message.</li>
              <li><strong>Business data:</strong> if you register for our Academy, your business type, experience level, and goals.</li>
              <li><strong>Marketing attribution data:</strong> the platform or campaign that referred you (e.g. TikTok, Instagram), UTM parameters, and any handle you share.</li>
            </ul>
            <p className="mt-3">
              We may also collect basic technical data (IP address, browser type, device) via server
              logs when you visit our site.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>To respond to your skincare enquiry or academy registration.</li>
              <li>To send you follow-up messages via WhatsApp, Telegram, or email regarding your enquiry.</li>
              <li>To provide personalised skincare guidance and product recommendations.</li>
              <li>To deliver Academy course materials and programme updates.</li>
              <li>To improve our services and understand how clients find us.</li>
              <li>To comply with applicable legal obligations.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">4. WhatsApp &amp; Messaging</h2>
            <p>
              By submitting a contact form on our website you consent to being contacted via
              WhatsApp, Telegram, or email in connection with your enquiry. We use the WhatsApp
              Business API (operated by Meta Platforms, Inc.) to send and receive messages. Message
              and data rates may apply depending on your mobile carrier. You may opt out of
              WhatsApp messages at any time by replying <strong>STOP</strong> or by contacting us
              at the address below.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">5. Sharing Your Information</h2>
            <p className="mb-3">
              We do not sell your personal data. We may share your information with:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Service providers:</strong> third-party platforms that help us operate our
                business (e.g. email delivery, messaging infrastructure), under data-processing
                agreements.
              </li>
              <li>
                <strong>Legal authorities:</strong> if required by law or to protect the rights,
                property, or safety of MICAHSKIN or others.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">6. Data Retention</h2>
            <p>
              We retain your personal data for as long as necessary to fulfil the purposes described
              in this policy, or as required by law. If you would like your data deleted, please
              contact us and we will act on your request within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">7. Security</h2>
            <p>
              We implement appropriate technical and organisational measures to protect your personal
              information against unauthorised access, loss, or disclosure. No transmission over
              the internet is completely secure; we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">8. Your Rights</h2>
            <p className="mb-3">Depending on your location, you may have the right to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data.</li>
              <li>Object to or restrict certain processing.</li>
              <li>Withdraw consent at any time (without affecting lawfulness of prior processing).</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, please contact us at{' '}
              <a href="mailto:micahskin4u@gmail.com" className="text-brand-600 hover:underline">
                micahskin4u@gmail.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">9. Third-Party Links</h2>
            <p>
              Our website may contain links to third-party websites. We are not responsible for
              the privacy practices of those sites and encourage you to review their privacy
              policies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">10. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material
              changes by posting the revised policy on this page with an updated effective date.
              Continued use of our services after such changes constitutes your acceptance of the
              revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">11. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy or your personal data, please
              contact us at:
            </p>
            <address className="mt-3 not-italic text-gray-600">
              <strong>MICAHSKIN</strong><br />
              Email:{' '}
              <a href="mailto:micahskin4u@gmail.com" className="text-brand-600 hover:underline">
                micahskin4u@gmail.com
              </a>
            </address>
          </section>

        </div>
      </div>
    </div>
  )
}
