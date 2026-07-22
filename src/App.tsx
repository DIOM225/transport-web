import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import RequireAuth from './components/RequireAuth';
import RequireRole from './components/RequireRole';

import Landing from './pages/Landing';
import Login from './pages/Login';
import DriverDashboard from './pages/DriverDashboard';
import AdminDashboard from './pages/AdminDashboard';
import TaxiDashboard from './pages/TaxiDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import { getUser } from './lib/auth';

/** Admin landing chooses the dashboard variant by the org's company type. */
function AdminRouter() {
  const user = getUser();
  return user?.companyType === 'TAXI_FLEET' ? <TaxiDashboard /> : <AdminDashboard />;
}

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
              <Route path="/admin" element={<AdminRouter />} />
            </Route>

            <Route element={<RequireRole allow={['SUPERADMIN']} />}>
              <Route path="/superadmin" element={<SuperAdminDashboard />} />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
