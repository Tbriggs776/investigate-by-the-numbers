import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Login from './pages/Login'
import Queue from './pages/Queue'
import LeadDetail from './pages/LeadDetail'
import CaseFile from './pages/CaseFile'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Queue />} />
        <Route path="lead/:awardId" element={<LeadDetail />} />
        <Route path="case/:awardId" element={<CaseFile />} />
      </Route>
    </Routes>
  )
}
