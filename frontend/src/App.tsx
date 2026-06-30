import { Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { MarketingHome } from './pages/MarketingHome'
import { Login } from './pages/Login'

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })))
const CreatePact = lazy(() => import('./pages/CreatePact').then(m => ({ default: m.CreatePact })))
const PactDetail = lazy(() => import('./pages/PactDetail').then(m => ({ default: m.PactDetail })))
const WitnessPage = lazy(() => import('./pages/WitnessPage').then(m => ({ default: m.WitnessPage })))
const DeliverPage = lazy(() => import('./pages/DeliverPage').then(m => ({ default: m.DeliverPage })))
const BetPage = lazy(() => import('./pages/BetPage').then(m => ({ default: m.BetPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })))
const JudgePage = lazy(() => import('./pages/JudgePage').then(m => ({ default: m.JudgePage })))

function Guard({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy()
  if (!ready) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div className="spinner" />
    </div>
  )
  if (!authenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RouteFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div className="spinner" />
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<MarketingHome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
          <Route path="/create" element={<Guard><CreatePact /></Guard>} />
          <Route path="/profile" element={<Guard><ProfilePage /></Guard>} />
          <Route path="/judge" element={<Guard><JudgePage /></Guard>} />
          <Route path="/pact/:id" element={<Guard><PactDetail /></Guard>} />
          <Route path="/w/:id" element={<WitnessPage />} />
          <Route path="/d/:id" element={<DeliverPage />} />
          <Route path="/b/:id" element={<BetPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
