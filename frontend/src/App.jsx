import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Hero from './components/Hero.jsx'
import ChoiceSection from './components/ChoiceSection.jsx'
import SkincareForm from './components/SkincareForm.jsx'
import SuccessMessage from './components/SuccessMessage.jsx'
import AdminLogin from './components/AdminLogin.jsx'
import AdminDashboard from './components/AdminDashboard.jsx'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage.jsx'
import TermsOfServicePage from './pages/TermsOfServicePage.jsx'
import ContactPage from './pages/ContactPage.jsx'
import AcademyPage from './pages/AcademyPage.jsx'
import AcademySuccessPage from './pages/AcademySuccessPage.jsx'
import { checkAdminSession, logoutAdmin } from './api/index.js'

// ---------------------------------------------------------------------------
// Version staleness detection
// ---------------------------------------------------------------------------

function useVersionCheck() {
  const [needsRefresh, setNeedsRefresh] = useState(false)

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (data.hash && data.hash !== __GIT_HASH__) {
          setNeedsRefresh(true)
        }
      } catch {
        // Dev mode or network failure — silently skip.
      }
    }

    check()

    // Re-check when the browser restores a page from the back-forward cache.
    function onPageShow(e) {
      if (e.persisted) check()
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  return needsRefresh
}

function UpdateBanner() {
  return (
    <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-4 bg-brand-600 px-4 py-2 text-sm text-white">
      <span>A new version is available.</span>
      <button
        onClick={() => window.location.reload()}
        className="font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
      >
        Refresh now
      </button>
    </div>
  )
}

// Maps lowercase query-param values to the canonical platform string stored in the DB.
const PLATFORM_MAP = { instagram: 'Instagram', tiktok: 'TikTok', other: 'Other' }

function parseUrlPrefill() {
  const params = new URLSearchParams(window.location.search)
  const rawSource = params.get('source') || ''
  return {
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

// Home handles the skincare funnel as internal state; academy navigates to /academy.
function HomeView() {
  const navigate = useNavigate()
  const [view, setView] = useState('home')
  const [prefill] = useState(parseUrlPrefill)

  if (view === 'skincare-form') {
    return (
      <SkincareForm
        prefill={prefill}
        onSuccess={() => setView('skincare-done')}
        onBack={() => setView('home')}
      />
    )
  }

  if (view === 'skincare-done') {
    return <SuccessMessage type="skincare" onReset={() => setView('home')} />
  }

  return (
    <>
      <Hero />
      <ChoiceSection
        onChoose={(path) => {
          if (path === 'skincare') {
            setView('skincare-form')
          } else {
            navigate('/academy')
          }
        }}
      />
    </>
  )
}

// Admin handles session check → login gate → dashboard at /admin.
function AdminView() {
  const navigate = useNavigate()
  // null = session check in progress | false = not authenticated | true = authenticated
  const [authed, setAuthed] = useState(null)

  useEffect(() => {
    checkAdminSession()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false))
  }, [])

  // When any protected API call returns 401 (e.g. backend restarted and cleared
  // the in-memory session store), automatically drop back to the login form so
  // the user isn't stuck on a stale CRM with silent failures.
  useEffect(() => {
    function onSessionExpired() { setAuthed(false) }
    window.addEventListener('session:expired', onSessionExpired)
    return () => window.removeEventListener('session:expired', onSessionExpired)
  }, [])

  async function handleLogout() {
    try {
      await logoutAdmin()
    } catch {
      // Ignore network errors — clear local state regardless
    }
    setAuthed(false)
  }

  if (authed === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (authed === false) {
    return <AdminLogin onSuccess={() => setAuthed(true)} />
  }

  return (
    <AdminDashboard
      onBack={() => navigate('/')}
      onLogout={handleLogout}
    />
  )
}

export default function App() {
  const needsRefresh = useVersionCheck()

  return (
    <>
      {needsRefresh && <UpdateBanner />}
      <Routes>
        <Route path="/" element={<Layout><HomeView /></Layout>} />
        <Route path="/academy" element={<Layout><AcademyPage /></Layout>} />
        <Route path="/academy/success" element={<Layout><AcademySuccessPage /></Layout>} />
        <Route path="/privacy-policy" element={<Layout><PrivacyPolicyPage /></Layout>} />
        <Route path="/terms-of-service" element={<Layout><TermsOfServicePage /></Layout>} />
        <Route path="/contact" element={<Layout><ContactPage /></Layout>} />
        <Route path="/admin" element={<AdminView />} />
      </Routes>
    </>
  )
}
