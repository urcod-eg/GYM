import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import { useLedger } from '../../app/LedgerContext';
import { DAY_KEYS, GENDER_MODES, hourRanges, hoursBetween, type Gender, type GenderMode, type LadiesHours } from '../../domain/gender';
import type { StringKey } from '../../i18n/strings';

/** The gym's men / ladies setup, from the settings (MIXED until an admin chooses otherwise). */
export function useGenderMode(): { mode: GenderMode; hours: LadiesHours } {
  const s = useLedger().settingsDoc;
  return { mode: s.genderMode ?? 'MIXED', hours: s.ladiesHours ?? {} };
}

export function genderKey(g: Gender | null | undefined): StringKey {
  return g === 'F' ? 'gender.F' : g === 'M' ? 'gender.M' : 'gender.none';
}

/** Men / ladies picker (two chips). */
export function GenderPicker({ value, onChange, id = 'gn', required }: { value: Gender | null; onChange: (g: Gender) => void; id?: string; required?: boolean }) {
  const { t } = useApp();
  return (
    <div className="field">
      <span className="label" id={`${id}-l`}>
        {t('gender.label')}
        {required ? ' *' : ''}
      </span>
      <div className="chips" role="group" aria-labelledby={`${id}-l`}>
        {(['M', 'F'] as Gender[]).map((g) => (
          <button key={g} type="button" className="chip" aria-pressed={value === g} onClick={() => onChange(g)}>
            {t(genderKey(g))}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GenderBadge({ g }: { g: Gender | null | undefined }) {
  const { t } = useApp();
  if (!g) return <span className="badge badge-warning no-dot">{t('gender.none')}</span>;
  return <span className={`badge no-dot ${g === 'F' ? 'badge-ladies' : 'badge-neutral'}`}>{t(genderKey(g))}</span>;
}

const pad = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

/** "10:00–14:00 · 18:00–20:00" */
export function rangesText(hours: number[]): string {
  return hourRanges(hours)
    .map(([a, b]) => `${pad(a)}–${b === 24 ? '24:00' : pad(b)}`)
    .join(' · ');
}

/** Labels: ladies' hours use 0 = Sunday; the app's day names use 0 = Saturday. */
/** Settings block: the mode, and (ladies' hours) one time range per weekday. */
export function GenderSettings({ mode, hours, onChange }: { mode: GenderMode; hours: LadiesHours; onChange: (mode: GenderMode, hours: LadiesHours) => void }) {
  const { t } = useApp();
  const setDay = (day: string, list: number[]) => onChange(mode, { ...hours, [day]: list });
  const firstRange = (day: string): [number, number] | null => hourRanges(hours[day] ?? [])[0] ?? null;
  const copyToAll = (day: string) => onChange(mode, Object.fromEntries(DAY_KEYS.map((d) => [d, [...(hours[day] ?? [])]])));
  const HOURS = Array.from({ length: 25 }, (_, i) => i);
  return (
    <div className="stack">
      <h2 className="section-title">{t('gender.title')}</h2>
      <div className="stack-sm">
        {GENDER_MODES.map((m) => (
          <label key={m} className={`mode-option ${mode === m ? 'on' : ''}`}>
            <input type="radio" name="gender-mode" checked={mode === m} onChange={() => onChange(m, hours)} />
            <span className="stack-sm" style={{ gap: 2 }}>
              <strong>{t(`gender.mode.${m}` as StringKey)}</strong>
              <span className="small muted">{t(`gender.modeHint.${m}` as StringKey)}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === 'SPLIT_HOURS' && (
        <div className="stack-sm">
          <span className="label">{t('gender.hoursTitle')}</span>
          <span className="hint">{t('gender.hoursHint')}</span>
          <div className="list">
            {DAY_KEYS.map((day) => {
              const r = firstRange(day);
              const extra = hourRanges(hours[day] ?? []).length > 1;
              return (
                <div key={day} className="list-item wrap" style={{ gap: 8, minHeight: 52 }}>
                  <label className="check-row" style={{ minWidth: 110 }}>
                    <input type="checkbox" checked={!!r} onChange={(e) => setDay(day, e.target.checked ? hoursBetween(10, 14) : [])} />
                    <strong>{t(`day.${(Number(day) + 1) % 7}` as StringKey)}</strong>
                  </label>
                  {r ? (
                    <span className="row wrap" style={{ gap: 6 }}>
                      <span className="small muted">{t('gender.from')}</span>
                      <select className="input" style={{ width: 92, minHeight: 36 }} value={r[0]} onChange={(e) => setDay(day, hoursBetween(Number(e.target.value), Math.max(Number(e.target.value) + 1, r[1])))} aria-label={t('gender.from')}>
                        {HOURS.slice(0, 24).map((h) => (
                          <option key={h} value={h}>{pad(h)}</option>
                        ))}
                      </select>
                      <span className="small muted">{t('gender.to')}</span>
                      <select className="input" style={{ width: 92, minHeight: 36 }} value={r[1]} onChange={(e) => setDay(day, hoursBetween(r[0], Number(e.target.value)))} aria-label={t('gender.to')}>
                        {HOURS.filter((h) => h > r[0]).map((h) => (
                          <option key={h} value={h}>{h === 24 ? '24:00' : pad(h)}</option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyToAll(day)}>{t('gender.copyAll')}</button>
                      {extra && <span className="xs muted">{rangesText(hours[day])}</span>}
                    </span>
                  ) : (
                    <span className="small muted">{t('gender.menAllDay')}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** On a member card: the section, and (front desk) setting or changing it. Hidden in a mixed gym. */
export function MemberGenderControl({ memberId, gender }: { memberId: string; gender: Gender | null | undefined }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const { mode } = useGenderMode();
  const [open, setOpen] = useState(!gender);
  const [busy, setBusy] = useState(false);
  if (mode === 'MIXED') return null;
  const save = async (g: Gender) => {
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      await data.setMemberGender(actor, memberId, g);
      toast(t('gender.saved'), 'success');
      setOpen(false);
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row wrap" style={{ gap: 8, alignItems: 'center' }} aria-busy={busy}>
      <GenderBadge g={gender} />
      {open ? (
        <GenderPicker value={gender ?? null} onChange={save} id={`g-${memberId}`} />
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          {t('gender.set')}
        </button>
      )}
    </div>
  );
}

/** Men / ladies filter chips for member lists (hidden in a mixed gym). */
export function GenderFilter({ value, onChange }: { value: Gender | 'ALL'; onChange: (v: Gender | 'ALL') => void }) {
  const { t } = useApp();
  const { mode } = useGenderMode();
  if (mode === 'MIXED') return null;
  return (
    <div className="chips" role="group" aria-label={t('gender.label')}>
      {(['ALL', 'M', 'F'] as const).map((g) => (
        <button key={g} type="button" className="chip" aria-pressed={value === g} onClick={() => onChange(g)}>
          {g === 'ALL' ? t('gender.filterAll') : t(genderKey(g))}
        </button>
      ))}
    </div>
  );
}
