import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';

import Landing from './pages/Landing';
import Login from './pages/Login';
import DriverDashboard from './pages/DriverDashboard';
import AdminDashboard from './pages/AdminDashboard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route element={<AppShell />}>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          {/* Protected */}
          <Route element={<RequireAuth />}>
            <Route element={<RequireRole allow={['DRIVER']} />}>
              <Route path="/driver" element={<DriverDashboard />} />
            </Route>

            <Route element={<RequireRole allow={['ADMIN', 'OPERATOR']} />}>
              <Route path="/admin" element={<AdminDashboard />} />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
