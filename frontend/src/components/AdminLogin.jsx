import { useState } from 'react'
import { loginAdmin } from '../api/index.js'

/**
 * AdminLogin — password gate for the admin dashboard.
 *
 * The password is sent to the backend and compared against the ADMIN_PASSWORD
 * env var. It is never stored or logged on the client side.
 * On success, the backend sets an HTTP-only session cookie and calls onSuccess().
 */
export default function AdminLogin({ onSuccess }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await loginAdmin(password)
      onSuccess()
    } catch {
      setError('Incorrect password. Try again.')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            MICAHSKIN <span className="text-brand-600">CRM</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1">Team access only</p>
        </div>

        {/* Login card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl border border-gray-200 p-8 space-y-4"
        >
          <div>
            <label
              htmlFor="admin-password"
              className="block text-sm font-medium text-gray-700 mb-1.5"
            >
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password"
              required
              autoFocus
              className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 transition"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
