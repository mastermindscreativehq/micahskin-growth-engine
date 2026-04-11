import { Link, useLocation } from 'react-router-dom'

export default function Navbar() {
  const { pathname } = useLocation()

  const linkClass = (path) =>
    `text-sm font-medium transition-colors ${
      pathname === path ? 'text-brand-600' : 'text-gray-500 hover:text-gray-800'
    }`

  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link
          to="/"
          className="text-brand-600 font-bold text-base tracking-widest uppercase hover:text-brand-700 transition-colors"
        >
          MICAHSKIN
        </Link>

        <div className="flex items-center gap-6">
          <Link to="/" className={linkClass('/')}>Home</Link>
          <Link to="/contact" className={linkClass('/contact')}>Contact</Link>
        </div>
      </div>
    </nav>
  )
}
