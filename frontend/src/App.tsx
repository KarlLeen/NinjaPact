import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { Landing } from './pages/Landing'
import { Dashboard } from './pages/Dashboard'
import { CreatePact } from './pages/CreatePact'
import { PactDetail } from './pages/PactDetail'
import { WitnessPage } from './pages/WitnessPage'
import { DeliverPage } from './pages/DeliverPage'
import { BetPage } from './pages/BetPage'
import { ProfilePage } from './pages/ProfilePage'

function Guard({ children }: { children: React.ReactNode }) {
  const { ready, authenticated } = usePrivy()
  if (!ready) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div className="spinner" />
    </div>
  )
  if (!authenticated) return <Navigate to="/" replace />
  return <>{children}</>
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Guard><Dashboard /></Guard>} />
        <Route path="/create" element={<Guard><CreatePact /></Guard>} />
        <Route path="/profile" element={<Guard><ProfilePage /></Guard>} />
        <Route path="/pact/:id" element={<Guard><PactDetail /></Guard>} />
        <Route path="/w/:id" element={<WitnessPage />} />
        <Route path="/d/:id" element={<DeliverPage />} />
        <Route path="/b/:id" element={<BetPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
