import { GenderPicker, useGenderMode } from './GenderUI';
import type { Gender } from '../../domain/gender';
import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { useGym } from '../../app/GymContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { Icon } from '../../components/Icon';
import { Avatar, Modal, Notice } from '../../components/ui';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import type { StaffAccount } from '../../firebase/data';
import { rolesInviterMayGrant } from '../../domain/identity';
import { formatEgyptPhone } from '../../domain/text';
import type { StringKey } from '../../i18n/strings';
import { Credentials, useLicenseOk } from './Accounts';
import { normalizeEgyptPhone } from '../../domain/text';

const DEMO_STAFF: StaffAccount[] = [
  { uid: 's1', kind: 'staff', roles: ['admin'], status: 'active', displayName: 'أ. خالد إبراهيم', phone: '+201001112223' },
  { uid: 's2', kind: 'staff', roles: ['cashier'], status: 'active', displayName: 'منى عبد الله', phone: '+201112223334' },
  { uid: 's3', kind: 'staff', roles: ['coach'], status: 'active', displayName: 'كابتن محمد سامي', phone: '+201223334445' },
  { uid: 's4', kind: 'staff', roles: ['cashier'], status: 'disabled', displayName: 'أحمد يوسف', phone: '+201534445556' },
];

export function useStaff() {
  const [rows, setRows] = useState<StaffAccount[] | null>(demoMode ? DEMO_STAFF : null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchStaff(setRows, setError).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return { rows, error };
}

export function useStaffStatus(): data.StaffStatus {
  const [st, setSt] = useState<data.StaffStatus>(demoMode ? { sessions: { s1: { at: new Date(), device: '' }, s2: { at: new Date(), device: '' } }, lockedUids: ['s3'] } : { sessions: {}, lockedUids: [] });
  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchStaffStatus(setSt).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return st;
}

const roleLabel = (t: (k: StringKey) => string, roles: string[]) => roles.map((r) => t(`role.${r}` as StringKey)).join('، ');

/**
 * Staff accounts. The admin invites accountants, cashiers and coaches; the developer also invites
 * and manages admins. The security rules enforce the same limits.
 */
export function StaffManager({ developer = false }: { developer?: boolean }) {
  const { t } = useApp();
  const actor = useActor();
  const roles = developer ? ['developer'] : actor.roles.filter((r) => r !== 'developer');
  const grantable = rolesInviterMayGrant(developer ? ['developer'] : roles);
  const { rows, error } = useStaff();
  const status = useStaffStatus();
  const licenseOk = useLicenseOk();
  const canWrite = developer || licenseOk !== false;
  const [inviting, setInviting] = useState(false);
  const list = (rows ?? []).filter((s) => (developer ? s.roles.includes('admin') : true));

  return (
    <div className="stack">
      <div className="row-between wrap">
        <div className="stack-sm" style={{ gap: 4 }}>
          <h2 className={developer ? 'section-title' : 'page-title'}>{developer ? t('dev.staffTitle') : t('staff.title')}</h2>
          <p className="muted small">{developer ? t('dev.staffBody') : t('staff.body')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setInviting(true)} disabled={!canWrite || grantable.length === 0}>
          <Icon name="plus" />
          {developer ? t('staff.inviteAdmin') : t('staff.invite')}
        </button>
      </div>
      {!canWrite && <Notice tone="warning" icon="alert">{t('acc.licenseOff')}</Notice>}
      {error ? (
        <Notice tone="danger" icon="alert">{t('acc.loadError')}</Notice>
      ) : rows === null ? (
        <p className="muted" aria-busy="true">…</p>
      ) : list.length === 0 ? (
        <p className="muted">{t('staff.empty')}</p>
      ) : (
        <div className="stack-sm">
          {list.map((s) => (
            <StaffCard key={s.uid} s={s} grantable={grantable} actorRoles={developer ? ['developer'] : roles} self={s.uid === actor.uid} canWrite={canWrite} online={!!status.sessions[s.uid]} locked={status.lockedUids.includes(s.uid)} />
          ))}
        </div>
      )}
      {inviting && <InviteStaff onClose={() => setInviting(false)} grantable={grantable} actorRoles={developer ? ['developer'] : roles} developer={developer} allStaff={rows ?? []} />}
    </div>
  );
}

type CardDialog = null | 'edit' | 'reset' | 'pin' | 'remove';

function StaffCard({ s, grantable, actorRoles, self, canWrite, online, locked }: { s: StaffAccount; grantable: string[]; actorRoles: string[]; self: boolean; canWrite: boolean; online: boolean; locked: boolean }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [dialog, setDialog] = useState<CardDialog>(null);
  const manageable = !self && s.roles.every((r) => grantable.includes(r));
  const disabled = s.status === 'disabled';
  const me = { ...actor, roles: actorRoles };

  const run = async (fn: () => Promise<unknown>, done: StringKey) => {
    if (demoMode) return toast(t('app.demoNoSave'));
    try {
      await fn();
      toast(t(done), 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    }
  };

  return (
    <section className="card stack-sm" style={{ padding: 16, opacity: disabled ? 0.75 : 1 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Avatar name={s.displayName} />
        <div className="grow stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <strong>
            {s.displayName} {self && <span className="muted small">({t('staff.you')})</span>}
          </strong>
          <span className="muted small">
            <bdi dir="ltr">{formatEgyptPhone(s.phone)}</bdi>
          </span>
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            <span className="badge">{roleLabel(t, s.roles)}</span>
            {online && !disabled && <span className="badge badge-success">{t('staff.online')}</span>}
            {locked && <span className="badge badge-warning">{t('staff.locked')}</span>}
            {disabled && <span className="badge badge-danger">{t('staff.disabled')}</span>}
          </div>
        </div>
      </div>
      {manageable ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setDialog('edit')} disabled={!canWrite}>
            <Icon name="edit" />
            {t('staff.edit')}
          </button>
          {!disabled && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => setDialog('reset')} disabled={!canWrite}>
                <Icon name="lock" />
                {t('staff.reset')}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setDialog('pin')} disabled={!canWrite}>
                <Icon name="shield" />
                {t('staff.newPin')}
              </button>
            </>
          )}
          {locked && (
            <button className="btn btn-primary-soft btn-sm" onClick={() => run(() => data.unlockStaffPin(me, s), 'staff.unlocked')} disabled={!canWrite}>
              <Icon name="check" />
              {t('staff.unlock')}
            </button>
          )}
          {online && (
            <button className="btn btn-ghost btn-sm" onClick={() => run(() => data.endStaffSessionFor(s), 'staff.sessionEnded')} disabled={!canWrite}>
              <Icon name="logout" />
              {t('staff.endSession')}
            </button>
          )}
          <button className={`btn btn-sm ${disabled ? 'btn-primary-soft' : 'btn-ghost'}`} onClick={() => run(() => data.updateStaffAccount(me, s, { status: disabled ? 'active' : 'disabled' }), 'staff.saved')} disabled={!canWrite}>
            <Icon name={disabled ? 'check' : 'x'} />
            {disabled ? t('staff.enable') : t('staff.disable')}
          </button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setDialog('remove')} disabled={!canWrite}>
            <Icon name="trash" />
            {t('staff.remove')}
          </button>
        </div>
      ) : (
        !self && s.roles.includes('admin') && <span className="muted xs">{t('staff.adminOnlyDev')}</span>
      )}
      {dialog === 'edit' && <EditDialog s={s} grantable={grantable} actorRoles={actorRoles} onClose={() => setDialog(null)} />}
      {dialog === 'reset' && <InviteStaff onClose={() => setDialog(null)} grantable={grantable} actorRoles={actorRoles} target={s} />}
      {dialog === 'pin' && <NewPinDialog s={s} actorRoles={actorRoles} onClose={() => setDialog(null)} />}
      {dialog === 'remove' && (
        <Modal open onClose={() => setDialog(null)} title={t('staff.remove')}>
          <div className="stack">
            <p>{t('staff.removeConfirm', { name: s.displayName })}</p>
            <div className="row wrap">
              <button className="btn btn-danger-solid grow" onClick={() => run(() => data.removeStaffAccount(me, s), 'staff.removed').then(() => setDialog(null))}>
                <Icon name="trash" />
                {t('staff.remove')}
              </button>
              <button className="btn btn-secondary grow" onClick={() => setDialog(null)}>{t('app.cancel')}</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** New 4-digit code for an existing account (password unchanged); ends their current session. */
function NewPinDialog({ s, actorRoles, onClose }: { s: StaffAccount; actorRoles: string[]; onClose: () => void }) {
  const { t, lang } = useApp();
  const gym = useGym();
  const actor = useActor();
  const errText = useErrorText();
  const [pin, setPin] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setErr(null);
    if (demoMode) return setPin('4826');
    setBusy(true);
    try {
      setPin(await data.setPinFor({ ...actor, roles: actorRoles }, s));
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`${t('staff.newPin')} — ${s.displayName}`}>
      <div className="stack">
        {pin ? (
          <Credentials phone={s.phone} pin={pin} text={t('cred.waPin', { name: s.displayName, gym: lang === 'ar' ? gym.nameAr : gym.nameEn, pin })} />
        ) : (
          <button className="btn btn-primary" onClick={create} disabled={busy} aria-busy={busy}>
            {t('staff.newPin')}
          </button>
        )}
        {err && <Notice tone="danger" icon="alert">{err}</Notice>}
      </div>
    </Modal>
  );
}

function RoleChips({ grantable, value, onChange }: { grantable: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const { t } = useApp();
  return (
    <div className="chips" role="group" aria-label={t('staff.roles')}>
      {grantable.map((r) => (
        <button key={r} type="button" className="chip" aria-pressed={value.includes(r)} onClick={() => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r])}>
          {t(`role.${r}` as StringKey)}
        </button>
      ))}
    </div>
  );
}

function EditDialog({ s, grantable, actorRoles, onClose }: { s: StaffAccount; grantable: string[]; actorRoles: string[]; onClose: () => void }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [roles, setRoles] = useState<string[]>(s.roles);
  const [name, setName] = useState(s.displayName);
  const [gender, setGender] = useState<Gender | null>(s.gender ?? null);
  const genderOn = useGenderMode().mode !== 'MIXED';
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (roles.length === 0) return setErr(t('staff.pickRole'));
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      await data.updateStaffAccount({ ...actor, roles: actorRoles }, s, { roles, ...(name.trim() !== s.displayName ? { displayName: name } : {}), ...(gender && gender !== s.gender ? { gender } : {}) });
      toast(t('staff.saved'), 'success');
      onClose();
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`${t('staff.edit')} — ${s.displayName}`}>
      <form className="stack" onSubmit={save} noValidate>
        <div className="field">
          <label className="label" htmlFor="en">{t('staff.name')}</label>
          <input id="en" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <span className="label">{t('staff.roles')}</span>
        <RoleChips grantable={grantable} value={roles} onChange={setRoles} />
        {genderOn && (
          <>
            <GenderPicker value={gender} onChange={setGender} id="st-g" />
            <span className="hint">{t('gender.staffHint')}</span>
          </>
        )}
        {err && <span className="error" role="alert">{err}</span>}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{t('app.save')}</button>
      </form>
    </Modal>
  );
}

/** New staff invite, or (with `target`) a new-password link for an existing staff account. */
function InviteStaff({ onClose, grantable, actorRoles, developer, target, allStaff = [] }: { onClose: () => void; grantable: string[]; actorRoles: string[]; developer?: boolean; target?: StaffAccount; allStaff?: StaffAccount[] }) {
  const { t, lang, toast } = useApp();
  const gym = useGym();
  const actor = useActor();
  const errText = useErrorText();
  const [name, setName] = useState(target?.displayName ?? '');
  const [phone, setPhone] = useState(target ? '0' + target.phone.slice(3) : '');
  const [roles, setRoles] = useState<string[]>(target?.roles ?? (developer ? ['admin'] : []));
  const [password, setPassword] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Same phone as an existing staff account: one person, one sign-in, several jobs.
  const [owner, setOwner] = useState<StaffAccount | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (roles.length === 0) return setErr(t('staff.pickRole'));
    if (!target && !normalizeEgyptPhone(phone)) return setErr(t('err.invalid-phone'));
    const existing = !target ? allStaff.find((x) => x.phone === normalizeEgyptPhone(phone)) : undefined;
    if (existing) return setOwner(existing);
    if (demoMode) {
      setPin('4826');
      return setPassword('kxtr5839');
    }
    setBusy(true);
    try {
      const r = await data.createStaffLogin({ ...actor, roles: actorRoles }, { phone, displayName: name, roles, target });
      setPin(r.pin);
      setPassword(r.password);
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };

  const gymName = lang === 'ar' ? gym.nameAr : gym.nameEn;
  const e164 = target?.phone ?? normalizeEgyptPhone(phone) ?? '';
  // Admins enter with 5 taps on the gym logo, everyone else with 3.
  const taps = roles.includes('admin') ? 5 : 3;
  const text = password
    ? t(target ? 'cred.waStaffReset' : 'cred.waStaff', { name, gym: gymName, roles: roleLabel(t, roles), url: window.location.href.split('#')[0], phone: formatEgyptPhone(e164), password, pin: pin ?? '', taps })
    : '';

  const isDev = actorRoles.includes('developer');
  // An admin account already opens the cashier, coach and accountant screens.
  const coveredByAdmin = !!owner && owner.roles.includes('admin') && roles.every((r) => r !== 'admin');
  const mergedRoles = owner ? [...new Set([...owner.roles, ...roles])].sort() : [];
  const canMerge = !!owner && !coveredByAdmin && owner.uid !== actor.uid && (isDev || !owner.roles.includes('admin'));
  const merge = async () => {
    if (!owner) return;
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    setErr(null);
    try {
      await data.updateStaffAccount({ ...actor, roles: actorRoles }, owner, { roles: mergedRoles });
      toast(t('staff.merged', { name: owner.displayName }), 'success');
      onClose();
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={target ? `${t('staff.reset')} — ${target.displayName}` : developer ? t('staff.inviteAdmin') : t('staff.invite')}>
      {owner ? (
        <div className="stack">
          {coveredByAdmin ? (
            <Notice tone="info" icon="shield">{t('staff.adminCovers', { name: owner.displayName })}</Notice>
          ) : canMerge ? (
            <>
              <p>{t('staff.mergeBody', { name: owner.displayName, roles: roleLabel(t, owner.roles), add: roleLabel(t, roles.filter((r) => !owner.roles.includes(r))) })}</p>
              <p className="small muted">{t('staff.mergeNote')}</p>
            </>
          ) : (
            <Notice tone="warning" icon="alert">{t('staff.mergeDenied', { name: owner.displayName })}</Notice>
          )}
          {err && <span className="error" role="alert">{err}</span>}
          <div className="row wrap">
            {canMerge && (
              <button className="btn btn-primary" onClick={merge} disabled={busy} aria-busy={busy}>
                <Icon name="plus" />
                {t('staff.mergeDo')}
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => (canMerge ? setOwner(null) : onClose())} disabled={busy}>
              {canMerge ? t('app.back') : t('app.close')}
            </button>
          </div>
        </div>
      ) : password ? (
        <div className="stack">
          <Credentials phone={e164} password={password} pin={pin ?? undefined} text={text} />
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {target && <p className="small">{t('reset.body')}</p>}
          <div className="field">
            <label className="label" htmlFor="sn">{t('staff.name')}</label>
            <input id="sn" className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!!target} autoComplete="off" />
          </div>
          <div className="field">
            <label className="label" htmlFor="sp">{t('staff.phone')}</label>
            <input id="sp" className="input ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!!target} placeholder="010 1234 5678" style={{ textAlign: 'start' }} />
          </div>
          {!target && (
            <div className="field">
              <span className="label">{t('staff.roles')}</span>
              <RoleChips grantable={grantable} value={roles} onChange={setRoles} />
            </div>
          )}
          {err && <span className="error" role="alert">{err}</span>}
          <button className="btn btn-primary btn-block" disabled={busy} aria-busy={busy}>
            {target ? t('reset.create') : t('staff.createLink')}
          </button>
        </form>
      )}
    </Modal>
  );
}
