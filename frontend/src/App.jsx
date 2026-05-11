import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import Results from './pages/Results'
import Rubric from './pages/Rubric'
import Pipeline from './pages/Pipeline'
import Agents from './pages/Agents'
import Login from './pages/Login'
import Spinner from './components/Spinner'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-[#0d1117] to-[#05070a]">
      <Spinner text="Loading…" dark />
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return children
}

function AppLayout() {
  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-slate-100 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/results"  element={<Results />} />
          <Route path="/agents"   element={<Agents />} />
          <Route path="/rubric"   element={<Rubric />} />
          <Route path="/pipeline" element={<Pipeline />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        } />
      </Routes>
    </AuthProvider>
  )
}
