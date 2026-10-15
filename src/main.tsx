import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider } from './app/AppContext';
import { GymProvider } from './app/GymContext';
import { PlansProvider } from './app/PlansContext';
import { LedgerProvider } from './app/LedgerContext';
import { DemoBar, PwaStatus } from './components/Shell';
import { AboutPage, ActivatePage, DevLoginPage, LoginPage, StaffLoginPage } from './pages/public/PublicPages';
import { RequireRole, SessionProvider } from './app/SessionContext';
import { demoMode } from './firebase/client';

// Each role is its own chunk: a member never downloads admin or cashier code.
const MemberArea = lazy(() => import('./pages/member/MemberArea').then((m) => ({ default: m.MemberArea })));
const CashierArea = lazy(() => import('./pages/staff/CashierArea').then((m) => ({ default: m.CashierArea })));
const CoachArea = lazy(() => import('./pages/staff/CoachArea').then((m) => ({ default: m.CoachArea })));
const AdminArea = lazy(() => import('./pages/staff/AdminArea').then((m) => ({ default: m.AdminArea })));
const DevConsole = lazy(() => import('./pages/dev/DevConsole').then((m) => ({ default: m.DevConsole })));
import './styles/app.css';

// The hosted preview build keeps navigation in memory; real deployments use the hash router.
const Router = import.meta.env.VITE_PREVIEW_HOST === '1' ? MemoryRouter : HashRouter;

// HashRouter: works on any static host (Firebase Hosting, GitHub Pages) without rewrite rules.
// Route guards read the signed-in profile (users/{uid}); the security rules check it again on every read and write.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <GymProvider>
      <SessionProvider>
      <PlansProvider>
      <LedgerProvider>
      <Router>
        {demoMode && <DemoBar />}
        <PwaStatus />
        <Suspense fallback={<div className="main" aria-busy="true" />}>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/staff-login" element={<StaffLoginPage />} />
          <Route path="/dev-login" element={<DevLoginPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/activate" element={<ActivatePage />} />
          <Route path="/member/*" element={<RequireRole any={['member']}><MemberArea /></RequireRole>} />
          <Route path="/cashier/*" element={<RequireRole any={['cashier', 'admin', 'developer']}><CashierArea /></RequireRole>} />
          <Route path="/coach/*" element={<RequireRole any={['coach', 'admin', 'developer']}><CoachArea /></RequireRole>} />
          <Route path="/admin/*" element={<RequireRole any={['admin', 'accountant', 'developer']}><AdminArea /></RequireRole>} />
          <Route path="/dev" element={<RequireRole any={['developer']}><DevConsole /></RequireRole>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </Router>
      </LedgerProvider>
      </PlansProvider>
      </SessionProvider>
      </GymProvider>
    </AppProvider>
  </StrictMode>,
);
