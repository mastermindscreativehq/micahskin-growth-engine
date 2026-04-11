import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Hero from './components/Hero.jsx'
import ChoiceSection from './components/ChoiceSection.jsx'
import SkincareForm from './components/SkincareForm.jsx'
import AcademyForm from './components/AcademyForm.jsx'
import SuccessMessage from './components/SuccessMessage.jsx'
import AdminLogin from './components/AdminLogin.jsx'
import AdminDashboard from './components/AdminDashboard.jsx'
import PrivacyPolicyPage from './pages/PrivacyPolicyPage.jsx'
import TermsOfServicePage from './pages/TermsOfServicePage.jsx'
import ContactPage from './pages/ContactPage.jsx'
import { checkAdminSession, logoutAdmin } from './api/index.js'

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

// Home handles the multi-step skincare / academy funnel as internal state.
function HomeView() {
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

  if (view === 'academy-form') {
    return (
      <AcademyForm
        prefill={prefill}
        onSuccess={() => setView('academy-done')}
        onBack={() => setView('home')}
      />
    )
  }

  if (view === 'skincare-done') {
    return <SuccessMessage type="skincare" onReset={() => setView('home')} />
  }

  if (view === 'academy-done') {
    return <SuccessMessage type="academy" onReset={() => setView('home')} />
  }

  return (
    <>
      <Hero />
      <ChoiceSection
        onChoose={(path) => setView(path === 'skincare' ? 'skincare-form' : 'academy-form')}
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
  return (
    <Routes>
      <Route path="/" element={<Layout><HomeView /></Layout>} />
      <Route path="/privacy-policy" element={<Layout><PrivacyPolicyPage /></Layout>} />
      <Route path="/terms-of-service" element={<Layout><TermsOfServicePage /></Layout>} />
      <Route path="/contact" element={<Layout><ContactPage /></Layout>} />
      <Route path="/admin" element={<AdminView />} />
    </Routes>
  )
}
