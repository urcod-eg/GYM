import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useApp } from '../../app/AppContext';
import { useLedger } from '../../app/LedgerContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { LineChart } from '../../components/Charts';
import { Icon } from '../../components/Icon';
import { Avatar, Modal, Notice, StatusBadge, VipBadge } from '../../components/ui';
import { adherence, gymDayIndex, MUSCLES, type Exercise, type LibraryExercise, type Muscle, type NutritionPlan, type PlanDay, type WeightEntry, type WorkoutPlan } from '../../domain/coaching';
import { GYM_TZ } from '../../domain/dates';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import type { StringKey } from '../../i18n/strings';
import { DEMO_WEEK, DEMO_WEIGHT, DEMO_WORKOUT } from '../../mock/demo';
import { liveRow, searchRows, type MemberRow } from './shared';
import { useStaff } from './StaffManager';

export const DAY_KEYS: StringKey[] = ['day.0', 'day.1', 'day.2', 'day.3', 'day.4', 'day.5', 'day.6'];

/** The sample plan, used in the preview. */
export const DEMO_PLAN: WorkoutPlan = {
  title: 'تضخيم وقوة',
  notes: '',
  days: DEMO_WEEK.map((d, i) => ({ day: i, focus: d.focusAr, exercises: i === 0 ? DEMO_WORKOUT.exercises.map((e) => ({ name: e.nameAr, sets: e.sets, reps: e.reps, rest: e.rest, target: e.target })) : [] })).filter((d) => d.focus !== 'راحة'),
};
export const DEMO_NUTRITION: NutritionPlan = {
  title: 'نظام تضخيم نظيف',
  notes: 'لترين ونص مية في اليوم على الأقل.',
  meals: [
    { name: 'الفطار', items: '4 بياض بيض + 1 بيضة كاملة، شوفان 60 جم، موزة' },
    { name: 'الغدا', items: 'فراخ 200 جم، رز 150 جم، سلطة' },
    { name: 'بعد التمرين', items: 'سكوب واي بروتين + تمرتين' },
    { name: 'العشا', items: 'تونة أو جبنة قريش، عيش أسمر، خضار' },
  ],
};

/** Live per-member document (plan, nutrition, logs); sample data in the preview. */
export function useMemberDoc<T>(collection: 'workoutPlans' | 'nutritionPlans' | 'workoutLogs' | 'bodyLogs', memberId: string | null, demo: T | null): T | null | undefined {
  const [doc, setDoc] = useState<T | null | undefined>(demoMode ? demo : undefined);
  useEffect(() => {
    if (demoMode || !memberId) return;
    setDoc(undefined);
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchMemberDoc<T>(collection, memberId, setDoc).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [collection, memberId]);
  return doc;
}

const lastDays = (n: number) => {
  const today = DateTime.now().setZone(GYM_TZ).startOf('day');
  return Array.from({ length: n }, (_, i) => {
    const d = today.minus({ days: n - 1 - i });
    return { iso: d.toISODate()!, gymDay: gymDayIndex(d.weekday) };
  });
};

/* ================================================================ trainee panel (coach + admin) */

export function TraineePanel({ r, coachId }: { r: MemberRow; coachId: string }) {
  const { t, lang, fmtDate, fmtNum } = useApp();
  const plan = useMemberDoc<WorkoutPlan>('workoutPlans', r.m.id, DEMO_PLAN);
  const food = useMemberDoc<NutritionPlan>('nutritionPlans', r.m.id, DEMO_NUTRITION);
  const log = useMemberDoc<{ days: Record<string, number[]> }>('workoutLogs', r.m.id, { days: {} });
  const body = useMemberDoc<{ entries: WeightEntry[] }>('bodyLogs', r.m.id, { entries: DEMO_WEIGHT.map((w) => ({ date: w.date, kg: w.kg })) });
  const [editing, setEditing] = useState<'workout' | 'food' | null>(null);
  const adh = adherence(plan ?? null, log?.days ?? {}, lastDays(14));
  const weights = body?.entries ?? [];

  return (
    <section className="card stack">
      <div className="row">
        <Avatar name={r.m.name} size="lg" />
        <div className="grow">
          <div className="row wrap" style={{ gap: 6 }}>
            <strong style={{ fontSize: '1.25rem' }}>{r.m.name}</strong>
            <VipBadge tier={r.m.vip} label={false} />
          </div>
          <div className="muted small">
            {(lang === 'ar' ? r.planAr : r.planEn) || '—'} · {t('cashier.ends')} {fmtDate(r.lastDay, 'short')}
          </div>
        </div>
      </div>
      <div className="grid-2">
        <div className="card card-flat stat">
          <span className="label">{t('coach.adherence')}</span>
          <span className="value">{adh === null ? '—' : `${fmtNum(adh)}%`}</span>
          <span className="xs muted">{t('coach.last14')}</span>
        </div>
        <div className="card card-flat stat">
          <span className="label">{t('member.weight')}</span>
          <span className="value">{weights.length ? `${fmtNum(weights.at(-1)!.kg)} kg` : '—'}</span>
          {weights.length > 1 && <span className="xs muted">{fmtNum(Math.round((weights.at(-1)!.kg - weights[0].kg) * 10) / 10)} kg</span>}
        </div>
      </div>
      {weights.length > 1 && <LineChart ariaLabel={t('member.weight')} points={weights.slice(-20).map((w) => ({ label: fmtDate(w.date, 'short'), value: w.kg }))} formatValue={(n) => n.toFixed(0)} height={150} />}

      <div className="row-between">
        <h2 className="card-title">{t('coach.plan')}: {plan?.title ?? t('coach.noPlan')}</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing('workout')} disabled={plan === undefined}>
          <Icon name="edit" />
          {t('coach.edit')}
        </button>
      </div>
      {plan?.days.length ? (
        <div className="list">
          {plan.days.map((d) => (
            <div key={d.day} className="list-item" style={{ minHeight: 44 }}>
              <strong style={{ minWidth: 90 }}>{t(DAY_KEYS[d.day])}</strong>
              <span className="grow">{d.focus}</span>
              <span className="badge badge-neutral no-dot">{t('coach.nEx', { n: d.exercises.length })}</span>
            </div>
          ))}
        </div>
      ) : (
        plan !== undefined && <p className="muted small">{t('coach.noPlanBody')}</p>
      )}

      <div className="row-between">
        <h2 className="card-title">{t('member.nutrition')}: {food?.title ?? '—'}</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing('food')} disabled={food === undefined}>
          <Icon name="edit" />
          {t('coach.edit')}
        </button>
      </div>
      {editing === 'workout' && <WorkoutEditor memberId={r.m.id} coachId={coachId} initial={plan ?? { title: '', days: [], notes: '' }} onClose={() => setEditing(null)} />}
      {editing === 'food' && <NutritionEditor memberId={r.m.id} coachId={coachId} initial={food ?? { title: '', meals: [{ name: '', items: '' }], notes: '' }} onClose={() => setEditing(null)} />}
    </section>
  );
}

/* ================================================================ editors */

const emptyEx = (): Exercise => ({ name: '', sets: 3, reps: '10', rest: 60, target: '' });

function WorkoutEditor({ memberId, coachId, initial, onClose }: { memberId: string; coachId: string; initial: WorkoutPlan; onClose: () => void }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [p, setP] = useState<WorkoutPlan>(JSON.parse(JSON.stringify(initial)));
  const [day, setDay] = useState<number>(initial.days[0]?.day ?? 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const library = useLibrary();
  const cur = p.days.find((d) => d.day === day);

  const setDayDoc = (f: (d: PlanDay) => PlanDay | null) =>
    setP((x) => {
      const existing = x.days.find((d) => d.day === day) ?? { day, focus: '', exercises: [] };
      const next = f(existing);
      const others = x.days.filter((d) => d.day !== day);
      return { ...x, days: next ? [...others, next].sort((a, b) => a.day - b.day) : others };
    });
  const setEx = (i: number, k: keyof Exercise, v: string | number) => setDayDoc((d) => ({ ...d, exercises: d.exercises.map((e, j) => (j === i ? { ...e, [k]: v } : e)) }));

  const save = async () => {
    if (!p.title.trim()) return setErr(t('coach.err.title'));
    if (demoMode) {
      toast(t('app.demoNoSave'));
      return onClose();
    }
    setBusy(true);
    setErr(null);
    try {
      await data.saveWorkoutPlan(actor, memberId, coachId, p);
      // A day with a title but no named exercise is saved empty: say so, the member would see nothing to do.
      const empty = p.days.filter((d) => !d.exercises.some((e) => e.name.trim()));
      if (empty.length) toast(t('coach.emptyDays', { days: empty.map((d) => t(DAY_KEYS[d.day])).join(' · ') }));
      else toast(t('coach.saved'), 'success');
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('coach.editPlan')}>
      <div className="stack">
        <div className="field">
          <label className="label" htmlFor="wp-t">{t('coach.planTitle')}</label>
          <input id="wp-t" className="input" maxLength={60} value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
        </div>
        <div className="chips" role="tablist">
          {DAY_KEYS.map((k, i) => (
            <button key={k} className="chip" aria-pressed={day === i} onClick={() => setDay(i)}>
              {t(k)}
              {p.days.some((d) => d.day === i) ? ' •' : ''}
            </button>
          ))}
        </div>
        {!cur ? (
          <button className="btn btn-secondary" onClick={() => setDayDoc(() => ({ day, focus: '', exercises: [emptyEx()] }))}>
            <Icon name="plus" />
            {t('coach.addDay')}
          </button>
        ) : (
          <div className="stack-sm">
            <div className="row">
              <input className="input grow" maxLength={40} placeholder={t('coach.focus')} value={cur.focus} onChange={(e) => setDayDoc((d) => ({ ...d, focus: e.target.value }))} aria-label={t('coach.focus')} />
              <button className="btn btn-ghost btn-sm" onClick={() => setDayDoc(() => null)} aria-label={t('coach.restDay')}>
                <Icon name="trash" />
                {t('coach.restDay')}
              </button>
            </div>
            {cur.exercises.map((e, i) => (
              <div key={i} className="card card-flat stack-sm" style={{ padding: 10 }}>
                <div className="row">
                  <input className="input grow" list="ex-lib" maxLength={60} placeholder={t('coach.exName')} value={e.name} onChange={(ev) => setEx(i, 'name', ev.target.value)} aria-label={t('coach.exName')} />
                  <button className="btn btn-ghost btn-sm" onClick={() => setDayDoc((d) => ({ ...d, exercises: d.exercises.filter((_, j) => j !== i) }))} aria-label={t('app.delete')}>
                    <Icon name="x" />
                  </button>
                </div>
                <div className="grid-4">
                  <label className="field">
                    <span className="xs muted">{t('member.sets')}</span>
                    <input className="input num" type="number" min={1} max={20} value={e.sets} onChange={(ev) => setEx(i, 'sets', Number(ev.target.value))} />
                  </label>
                  <label className="field">
                    <span className="xs muted">{t('member.reps')}</span>
                    <input className="input ltr" maxLength={12} value={e.reps} onChange={(ev) => setEx(i, 'reps', ev.target.value)} />
                  </label>
                  <label className="field">
                    <span className="xs muted">{t('member.rest')} (s)</span>
                    <input className="input num" type="number" min={0} max={600} value={e.rest} onChange={(ev) => setEx(i, 'rest', Number(ev.target.value))} />
                  </label>
                  <label className="field">
                    <span className="xs muted">{t('coach.target')}</span>
                    <input className="input ltr" maxLength={20} value={e.target} onChange={(ev) => setEx(i, 'target', ev.target.value)} />
                  </label>
                </div>
              </div>
            ))}
            {cur.exercises.length < 12 && (
              <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setDayDoc((d) => ({ ...d, exercises: [...d.exercises, emptyEx()] }))}>
                <Icon name="plus" />
                {t('coach.addEx')}
              </button>
            )}
          </div>
        )}
        <datalist id="ex-lib">
          {(library ?? []).map((x) => (
            <option key={x.id} value={x.nameAr} />
          ))}
        </datalist>
        <div className="field">
          <label className="label" htmlFor="wp-n">{t('coach.notes')}</label>
          <textarea id="wp-n" className="input" rows={2} maxLength={500} value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} style={{ padding: 10 }} />
        </div>
        {err && <span className="error" role="alert">{err}</span>}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={save}>{t('coach.publish')}</button>
      </div>
    </Modal>
  );
}

function NutritionEditor({ memberId, coachId, initial, onClose }: { memberId: string; coachId: string; initial: NutritionPlan; onClose: () => void }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [p, setP] = useState<NutritionPlan>(JSON.parse(JSON.stringify(initial)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (!p.title.trim()) return setErr(t('coach.err.title'));
    if (demoMode) {
      toast(t('app.demoNoSave'));
      return onClose();
    }
    setBusy(true);
    setErr(null);
    try {
      await data.saveNutritionPlan(actor, memberId, coachId, p);
      toast(t('coach.saved'), 'success');
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={t('coach.editFood')}>
      <div className="stack">
        <div className="field">
          <label className="label" htmlFor="np-t">{t('coach.planTitle')}</label>
          <input id="np-t" className="input" maxLength={60} value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
        </div>
        {p.meals.map((m, i) => (
          <div key={i} className="card card-flat stack-sm" style={{ padding: 10 }}>
            <div className="row">
              <input className="input grow" maxLength={40} placeholder={t('coach.mealName')} value={m.name} onChange={(e) => setP({ ...p, meals: p.meals.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={t('coach.mealName')} />
              <button className="btn btn-ghost btn-sm" onClick={() => setP({ ...p, meals: p.meals.filter((_, j) => j !== i) })} aria-label={t('app.delete')}>
                <Icon name="x" />
              </button>
            </div>
            <textarea className="input" rows={2} maxLength={300} placeholder={t('coach.mealItems')} value={m.items} onChange={(e) => setP({ ...p, meals: p.meals.map((x, j) => (j === i ? { ...x, items: e.target.value } : x)) })} style={{ padding: 10 }} aria-label={t('coach.mealItems')} />
          </div>
        ))}
        {p.meals.length < 8 && (
          <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setP({ ...p, meals: [...p.meals, { name: '', items: '' }] })}>
            <Icon name="plus" />
            {t('coach.addMeal')}
          </button>
        )}
        <div className="field">
          <label className="label" htmlFor="np-n">{t('coach.notes')}</label>
          <textarea id="np-n" className="input" rows={2} maxLength={800} value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} style={{ padding: 10 }} />
        </div>
        {err && <span className="error" role="alert">{err}</span>}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy} onClick={save}>{t('coach.publish')}</button>
      </div>
    </Modal>
  );
}

/* ================================================================ coach area (live) */

export function LiveTrainees() {
  const { t } = useApp();
  const actor = useActor();
  const [docs, setDocs] = useState<data.MemberDoc[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchMyTrainees(actor.uid, setDocs, () => setDocs([])).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [actor.uid]);
  const rows = useMemo(() => (docs ?? []).map((d) => liveRow(d)), [docs]);
  const r = rows.find((x) => x.m.id === sel) ?? rows[0];
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="stack">
        <h1 className="page-title">{t('coach.title')}</h1>
        <div className="card" style={{ padding: 8 }}>
          {docs === null ? (
            <p className="muted" style={{ padding: 12 }} aria-busy="true">…</p>
          ) : rows.length === 0 ? (
            <p className="muted" style={{ padding: 12 }}>{t('coach.noTrainees')}</p>
          ) : (
            rows.map((x) => (
              <button key={x.m.id} className="list-item" aria-current={x.m.id === r?.m.id} onClick={() => setSel(x.m.id)}>
                <Avatar name={x.m.name} />
                <div className="grow">
                  <div className="row" style={{ gap: 6 }}>
                    <strong>{x.m.name}</strong>
                    <VipBadge tier={x.m.vip} label={false} />
                  </div>
                  <div className="muted xs ltr">{x.m.code}</div>
                </div>
                <StatusBadge phase={x.phase} blocked={x.m.blocked} cancelled={x.cancelled} />
              </button>
            ))
          )}
        </div>
      </section>
      {r && <TraineePanel r={r} coachId={actor.uid} />}
    </div>
  );
}

/* ================================================================ exercise library */

const DEMO_LIB: data.LibraryRow[] = [
  { id: 'bench', nameAr: 'بنش برس بالبار', nameEn: 'Barbell bench press', muscle: 'chest', tips: 'الكتف لورا، والبار ينزل لنص الصدر.' },
  { id: 'squat', nameAr: 'سكوات', nameEn: 'Back squat', muscle: 'legs', tips: 'الركبة في اتجاه صوابع الرجل.' },
  { id: 'row', nameAr: 'سحب بار', nameEn: 'Barbell row', muscle: 'back', tips: '' },
  { id: 'plank', nameAr: 'بلانك', nameEn: 'Plank', muscle: 'core', tips: '' },
];

export function useLibrary() {
  const [rows, setRows] = useState<data.LibraryRow[] | null>(demoMode ? DEMO_LIB : null);
  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchExercises(setRows, () => setRows([])).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return rows;
}

export function LibraryPage() {
  const { t, lang } = useApp();
  const rows = useLibrary();
  const [muscle, setMuscle] = useState<Muscle | 'ALL'>('ALL');
  const [edit, setEdit] = useState<{ id: string | null; doc: LibraryExercise } | null>(null);
  const shown = (rows ?? []).filter((x) => muscle === 'ALL' || x.muscle === muscle);
  return (
    <div className="stack">
      <div className="row-between wrap">
        <h1 className="page-title">{t('coach.library')}</h1>
        <button className="btn btn-primary" onClick={() => setEdit({ id: null, doc: { nameAr: '', nameEn: '', muscle: 'chest', tips: '' } })}>
          <Icon name="plus" />
          {t('lib.add')}
        </button>
      </div>
      <div className="chips">
        <button className="chip" aria-pressed={muscle === 'ALL'} onClick={() => setMuscle('ALL')}>{t('app.all')}</button>
        {MUSCLES.map((m) => (
          <button key={m} className="chip" aria-pressed={muscle === m} onClick={() => setMuscle(m)}>
            {t(`muscle.${m}` as StringKey)}
          </button>
        ))}
      </div>
      <section className="card" style={{ padding: 8 }}>
        {rows === null ? (
          <p className="muted" style={{ padding: 12 }} aria-busy="true">…</p>
        ) : shown.length === 0 ? (
          <p className="muted" style={{ padding: 12 }}>{t('lib.empty')}</p>
        ) : (
          shown.map((x) => (
            <button key={x.id} className="list-item" onClick={() => setEdit({ id: x.id, doc: x })}>
              <Icon name="dumbbell" />
              <div className="grow">
                <strong>{lang === 'ar' ? x.nameAr : x.nameEn || x.nameAr}</strong>
                {x.tips && <div className="xs muted">{x.tips}</div>}
              </div>
              <span className="badge badge-neutral no-dot">{t(`muscle.${x.muscle}` as StringKey)}</span>
            </button>
          ))
        )}
      </section>
      {edit && <LibraryEditor id={edit.id} initial={edit.doc} onClose={() => setEdit(null)} />}
    </div>
  );
}

function LibraryEditor({ id, initial, onClose }: { id: string | null; initial: LibraryExercise; onClose: () => void }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [d, setD] = useState<LibraryExercise>(initial);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => {
    if (demoMode) {
      toast(t('app.demoNoSave'));
      return onClose();
    }
    setBusy(true);
    try {
      await f();
      toast(t('coach.saved'), 'success');
      onClose();
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={id ? t('lib.edit') : t('lib.add')}>
      <div className="stack">
        <div className="grid-2">
          <div className="field">
            <label className="label" htmlFor="lx-ar">{t('plan.nameAr')}</label>
            <input id="lx-ar" className="input" maxLength={60} value={d.nameAr} onChange={(e) => setD({ ...d, nameAr: e.target.value })} />
          </div>
          <div className="field">
            <label className="label" htmlFor="lx-en">{t('plan.nameEn')}</label>
            <input id="lx-en" className="input" dir="ltr" maxLength={60} value={d.nameEn} onChange={(e) => setD({ ...d, nameEn: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <span className="label">{t('lib.muscle')}</span>
          <div className="chips">
            {MUSCLES.map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={d.muscle === m} onClick={() => setD({ ...d, muscle: m })}>
                {t(`muscle.${m}` as StringKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="lx-tips">{t('lib.tips')}</label>
          <textarea id="lx-tips" className="input" rows={3} maxLength={300} value={d.tips} onChange={(e) => setD({ ...d, tips: e.target.value })} style={{ padding: 10 }} />
        </div>
        <div className="row wrap">
          <button className="btn btn-primary grow" disabled={busy || !d.nameAr.trim()} onClick={() => run(() => data.saveExercise(actor, id, d))}>{t('app.save')}</button>
          {id && (
            <button className="btn btn-danger grow" disabled={busy} onClick={() => run(() => data.deleteExercise(id))}>
              <Icon name="trash" />
              {t('app.delete')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ================================================================ admin: coaches */

export function CoachesPage() {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const { rows: staff } = useStaff();
  const rows = useLedger().rows ?? [];
  const coaches = (staff ?? []).filter((s) => s.roles.includes('coach') && s.status === 'active');
  const demoCoaches = [
    { uid: 'c1', displayName: 'كابتن محمد سامي' },
    { uid: 'c2', displayName: 'كابتن ندى فاروق' },
    { uid: 'c3', displayName: 'كابتن عمر حسن' },
  ];
  const list = demoMode ? demoCoaches : coaches.map((c) => ({ uid: c.uid, displayName: c.displayName }));
  const [assigning, setAssigning] = useState(false);
  const [openPlan, setOpenPlan] = useState<MemberRow | null>(null);
  const unassigned = rows.filter((r) => !r.m.coachId && r.phase !== 'NONE').length;

  const assign = async (memberId: string, coach: { uid: string; name: string } | null) => {
    if (demoMode) return toast(t('app.demoNoSave'));
    try {
      await data.assignMemberCoach(actor, memberId, coach);
      toast(t('staff.saved'), 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    }
  };

  return (
    <div className="stack">
      <div className="row-between wrap">
        <div className="stack-sm" style={{ gap: 4 }}>
          <h1 className="page-title">{t('admin.coaches')}</h1>
          <p className="muted small">{t('coachAdmin.body', { n: unassigned })}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAssigning(true)} disabled={list.length === 0}>
          <Icon name="plus" />
          {t('coachAdmin.assign')}
        </button>
      </div>
      {list.length === 0 && <Notice icon="info">{t('coachAdmin.noCoaches')}</Notice>}
      <div className="grid-2">
        {list.map((c) => {
          const mine = rows.filter((r) => r.m.coachId === c.uid);
          return (
            <section key={c.uid} className="card stack-sm">
              <div className="row">
                <Avatar name={c.displayName} />
                <strong className="grow">{c.displayName}</strong>
                <span className="badge badge-neutral no-dot">{t('coachAdmin.count', { n: mine.length })}</span>
              </div>
              {mine.slice(0, 12).map((r) => (
                <div key={r.m.id} className="list-item" style={{ minHeight: 44 }}>
                  <span className="grow">{r.m.name}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setOpenPlan(r)}>{t('coach.plan')}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => assign(r.m.id, null)} aria-label={t('coachAdmin.unassign')}>
                    <Icon name="x" />
                  </button>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      {assigning && <AssignCoach coaches={list} onPick={(m, c) => assign(m, c).then(() => setAssigning(false))} onClose={() => setAssigning(false)} />}
      {openPlan && (
        <Modal open onClose={() => setOpenPlan(null)} title={openPlan.m.name}>
          <TraineePanel r={openPlan} coachId={openPlan.m.coachId ?? actor.uid} />
        </Modal>
      )}
    </div>
  );
}

function AssignCoach({ coaches, onPick, onClose }: { coaches: { uid: string; displayName: string }[]; onPick: (memberId: string, coach: { uid: string; name: string }) => void; onClose: () => void }) {
  const { t } = useApp();
  const rows = useLedger().rows ?? [];
  const [coach, setCoach] = useState(coaches[0]?.uid ?? '');
  const [q, setQ] = useState('');
  const found = q.trim() ? searchRows(rows, q).slice(0, 8) : rows.filter((r) => !r.m.coachId && r.phase !== 'NONE').slice(0, 8);
  const c = coaches.find((x) => x.uid === coach);
  return (
    <Modal open onClose={onClose} title={t('coachAdmin.assign')}>
      <div className="stack">
        <select className="select" value={coach} onChange={(e) => setCoach(e.target.value)} aria-label={t('member.coach')}>
          {coaches.map((x) => (
            <option key={x.uid} value={x.uid}>{x.displayName}</option>
          ))}
        </select>
        <input className="input" placeholder={t('cashier.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} />
        {found.map((r) => (
          <button key={r.m.id} className="list-item" disabled={!c} onClick={() => c && onPick(r.m.id, { uid: c.uid, name: c.displayName })}>
            <Avatar name={r.m.name} />
            <div className="grow">
              <strong>{r.m.name}</strong>
              <div className="xs muted">{r.coach ?? t('member.noCoach')}</div>
            </div>
            <Icon name="plus" />
          </button>
        ))}
      </div>
    </Modal>
  );
}
