import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="bg-white border-t border-gray-100 py-10">
      <div className="max-w-5xl mx-auto px-6 flex flex-col items-center gap-4">
        <p className="text-sm font-bold text-brand-600 tracking-widest uppercase">
          MICAHSKIN
        </p>

        <p className="text-xs text-gray-400 text-center max-w-sm">
          Transforming skin — and the brands that care for it.
        </p>

        <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 mt-1">
          <Link
            to="/privacy-policy"
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Privacy Policy
          </Link>
          <Link
            to="/terms-of-service"
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Terms of Service
          </Link>
          <Link
            to="/contact"
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Contact
          </Link>
        </nav>

        <p className="text-xs text-gray-300 mt-1">
          © {new Date().getFullYear()} MICAHSKIN. All rights reserved.
        </p>

        <p className="text-xs text-gray-200 font-mono">
          Build: {__GIT_HASH__}
        </p>

        <Link
          to="/admin"
          className="text-xs text-gray-200 hover:text-gray-400 transition-colors mt-1"
        >
          Team access
        </Link>
      </div>
    </footer>
  )
}
