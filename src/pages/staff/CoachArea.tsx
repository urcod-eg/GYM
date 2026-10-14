import { useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp, useServerAction } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { Shell, type NavItem } from '../../components/Shell';
import { Avatar, PlaceholderPage, StatusBadge, VipBadge } from '../../components/ui';
import { DEMO_WORKOUT } from '../../mock/demo';
import { memberRows } from './shared';

const ME = 'c1'; // demo: signed in as كابتن محمد سامي

export function CoachArea() {
  const { t } = useApp();
  const nav: NavItem[] = [
    { to: '/coach', label: t('coach.title'), icon: 'users', end: true },
    { to: '/coach/library', label: t('coach.library'), icon: 'dumbbell' },
  ];
  return (
    <Shell nav={nav} defaultTheme="light" title={t('role.coach')}>
      <Routes>
        <Route index element={<Trainees />} />
        <Route path="library" element={<PlaceholderPage title={t('coach.library')} phase={5} />} />
        <Route path="*" element={<Navigate to="/coach" replace />} />
      </Routes>
    </Shell>
  );
}

function Trainees() {
  const { t, lang, fmtDate } = useApp();
  const server = useServerAction();
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
      {r && (
        <section className="card stack">
          <div className="row">
            <Avatar name={r.m.name} size="lg" />
            <div className="grow">
              <strong style={{ fontSize: '1.25rem' }}>{r.m.name}</strong>
              <div className="muted small">
                {lang === 'ar' ? r.planAr : r.planEn} · {t('cashier.ends')} {fmtDate(r.lastDay, 'short')}
              </div>
            </div>
          </div>
          <h2 className="card-title">
            {t('coach.plan')}: {lang === 'ar' ? DEMO_WORKOUT.titleAr : DEMO_WORKOUT.titleEn}
          </h2>
          <div>
            {DEMO_WORKOUT.exercises.map((e) => (
              <div key={e.nameEn} className="exercise" style={{ gridTemplateColumns: '1fr auto' }}>
                <div>
                  <div className="bold">{lang === 'ar' ? e.nameAr : e.nameEn}</div>
                  <div className="muted small num">
                    {e.sets} × {e.reps} · {e.rest}s
                  </div>
                </div>
                <span className="badge badge-neutral no-dot ltr">{e.target}</span>
              </div>
            ))}
          </div>
          <div className="row">
            <button className="btn btn-secondary grow" onClick={server}>
              <Icon name="dumbbell" />
              {t('coach.edit')}
            </button>
            <button className="btn btn-primary grow" onClick={server}>
              {t('coach.publish')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
