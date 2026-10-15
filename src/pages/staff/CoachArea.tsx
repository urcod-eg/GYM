import { useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { Shell, type NavItem } from '../../components/Shell';
import { Avatar, StatusBadge, VipBadge } from '../../components/ui';
import { memberRows } from './shared';
import { demoMode } from '../../firebase/client';
import { LibraryPage, LiveTrainees, TraineePanel } from './Coaching';

const ME = 'c1'; // demo: signed in as كابتن محمد سامي

export function CoachArea() {
  const { t } = useApp();
  const nav: NavItem[] = [
    { to: '/coach', label: t('coach.title'), icon: 'users', end: true },
    { to: '/coach/library', label: t('coach.library'), icon: 'dumbbell' },
  ];
  return (
    <Shell nav={nav} defaultTheme="light" title={t('role.coach')} livePaths={['/coach']}>
      <Routes>
        <Route index element={demoMode ? <Trainees /> : <LiveTrainees />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="*" element={<Navigate to="/coach" replace />} />
      </Routes>
    </Shell>
  );
}

function Trainees() {
  const { t } = useApp();
  // A coach only ever receives their own trainees (enforced by rules in Phase 5).
  const mine = useMemo(() => memberRows().filter((r) => r.m.coachId === ME), []);
  const [sel, setSel] = useState(mine[0]?.m.id);
  const r = mine.find((x) => x.m.id === sel);
  const adherence = [92, 68, 75, 40, 85];

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="stack">
        <h1 className="page-title">{t('coach.title')}</h1>
        <div className="card" style={{ padding: 8 }}>
          {mine.map((x, i) => (
            <button key={x.m.id} className="list-item" aria-current={x.m.id === sel} onClick={() => setSel(x.m.id)}>
              <Avatar name={x.m.name} />
              <div className="grow">
                <div className="row" style={{ gap: 6 }}>
                  <strong>{x.m.name}</strong>
                  <VipBadge tier={x.m.vip} label={false} />
                </div>
                <div className="muted xs">
                  {t('coach.adherence')} {adherence[i % adherence.length]}%
                </div>
              </div>
              <StatusBadge phase={x.phase} blocked={x.m.blocked} />
            </button>
          ))}
        </div>
      </section>
      {r && <TraineePanel r={r} coachId={ME} />}
    </div>
  );
}
