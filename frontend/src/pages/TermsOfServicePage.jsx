export default function TermsOfServicePage() {
  return (
    <div className="bg-cream-50 py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-400 mb-10">Effective date: January 1, 2025</p>

        <div className="space-y-10 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">1. Agreement to Terms</h2>
            <p>
              By accessing our website or using any of our services — including skincare consultation,
              the MICAHSKIN Academy programme, or any communication via WhatsApp, Telegram, or email
              — you agree to be bound by these Terms of Service ("Terms"). If you do not agree,
              please do not use our services.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">2. Services</h2>
            <p className="mb-3">MICAHSKIN provides two primary services:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Skincare Consultation:</strong> Personalised skincare guidance delivered
                via messaging channels based on information you provide about your skin concerns.
              </li>
              <li>
                <strong>MICAHSKIN Academy:</strong> An educational programme designed to help
                individuals build and grow a skincare business, delivered through online materials,
                mentorship, and community resources.
              </li>
            </ul>
            <p className="mt-3">
              We reserve the right to modify, suspend, or discontinue any service at any time
              with reasonable notice.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">3. Eligibility</h2>
            <p>
              You must be at least 18 years of age to use our services or submit any personal
              information through our website. By using our services, you represent that you meet
              this requirement.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">4. Not Medical Advice</h2>
            <p>
              The skincare information, product recommendations, and guidance provided by MICAHSKIN
              are for informational and educational purposes only. Nothing we share constitutes
              medical advice, diagnosis, or treatment. Always consult a qualified healthcare
              professional for medical concerns or before making significant changes to your
              skincare regimen if you have a medical skin condition.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">5. Payments &amp; Refunds</h2>
            <p className="mb-3">
              Where a service requires payment (such as the Academy programme):
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>All fees are stated in the applicable currency at the time of purchase.</li>
              <li>
                Payment is due in full before access is granted unless a payment plan is explicitly
                agreed in writing.
              </li>
              <li>
                Refund requests must be submitted within 7 days of purchase. Refunds will not be
                issued after course materials have been accessed.
              </li>
              <li>
                We reserve the right to change our pricing with reasonable advance notice.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">6. User Obligations</h2>
            <p className="mb-3">When using our services, you agree to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide accurate and complete information in all forms and communications.</li>
              <li>
                Not share, reproduce, or distribute any proprietary course content from the Academy
                without prior written consent.
              </li>
              <li>Treat our team and any community members with respect.</li>
              <li>Not use our services for any unlawful purpose.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">7. Intellectual Property</h2>
            <p>
              All content on this website and within the Academy programme — including text,
              images, graphics, videos, and course materials — is the property of MICAHSKIN and
              is protected by applicable copyright and intellectual property laws. You may not
              reproduce or distribute any content without our express written permission.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">8. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, MICAHSKIN shall not be liable for any
              indirect, incidental, special, or consequential damages arising from your use of
              our services, reliance on our skincare guidance, or your participation in the
              Academy programme. Our total liability for any claim shall not exceed the amount
              you paid for the relevant service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">9. Messaging Consent</h2>
            <p>
              By submitting a form on our website, you consent to receiving follow-up messages
              via WhatsApp, Telegram, or email. You may opt out at any time by replying{' '}
              <strong>STOP</strong> or contacting us directly.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">10. Governing Law</h2>
            <p>
              These Terms are governed by and construed in accordance with applicable law. Any
              disputes arising from these Terms or your use of our services shall be resolved
              through good-faith negotiation in the first instance.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">11. Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. We will post the revised Terms on this
              page with an updated effective date. Your continued use of our services after any
              such changes constitutes acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-800 mb-3">12. Contact</h2>
            <p>
              Questions about these Terms? Reach us at:
            </p>
            <address className="mt-3 not-italic text-gray-600">
              <strong>MICAHSKIN</strong><br />
              Email:{' '}
              <a href="mailto:hello@micahskin.com" className="text-brand-600 hover:underline">
                hello@micahskin.com
              </a>
            </address>
          </section>

        </div>
      </div>
    </div>
  )
}
