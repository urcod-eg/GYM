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
import { ShareText, useLicenseOk } from './Accounts';

const DEMO_STAFF: StaffAccount[] = [
  { uid: 's1', kind: 'staff', roles: ['admin'], status: 'active', displayName: 'أ. خالد إبراهيم', phone: '+201001112223' },
  { uid: 's2', kind: 'staff', roles: ['cashier'], status: 'active', displayName: 'منى عبد الله', phone: '+201112223334' },
  { uid: 's3', kind: 'staff', roles: ['coach'], status: 'active', displayName: 'كابتن محمد سامي', phone: '+201223334445' },
  { uid: 's4', kind: 'staff', roles: ['cashier'], status: 'disabled', displayName: 'أحمد يوسف', phone: '+201534445556' },
];

function useStaff() {
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
            <StaffCard key={s.uid} s={s} grantable={grantable} actorRoles={developer ? ['developer'] : roles} self={s.uid === actor.uid} canWrite={canWrite} />
          ))}
        </div>
      )}
      {inviting && <InviteStaff onClose={() => setInviting(false)} grantable={grantable} actorRoles={developer ? ['developer'] : roles} developer={developer} />}
    </div>
  );
}

function StaffCard({ s, grantable, actorRoles, self, canWrite }: { s: StaffAccount; grantable: string[]; actorRoles: string[]; self: boolean; canWrite: boolean }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [dialog, setDialog] = useState<null | 'roles' | 'reset'>(null);
  const manageable = !self && s.roles.every((r) => grantable.includes(r));
  const disabled = s.status === 'disabled';

  const toggle = async () => {
    if (demoMode) return toast(t('app.demoNoSave'));
    try {
      await data.updateStaffAccount({ ...actor, roles: actorRoles }, s, { status: disabled ? 'active' : 'disabled' });
      toast(t('staff.saved'), 'success');
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
            {disabled && <span className="badge badge-danger">{t('staff.disabled')}</span>}
          </div>
        </div>
      </div>
      {manageable ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setDialog('roles')} disabled={!canWrite}>
            <Icon name="edit" />
            {t('staff.editRoles')}
          </button>
          {!disabled && (
            <button className="btn btn-secondary btn-sm" onClick={() => setDialog('reset')} disabled={!canWrite}>
              <Icon name="lock" />
              {t('staff.reset')}
            </button>
          )}
          <button className={`btn btn-sm ${disabled ? 'btn-primary-soft' : 'btn-ghost'}`} onClick={toggle} disabled={!canWrite}>
            <Icon name={disabled ? 'check' : 'x'} />
            {disabled ? t('staff.enable') : t('staff.disable')}
          </button>
        </div>
      ) : (
        !self && s.roles.includes('admin') && <span className="muted xs">{t('staff.adminOnlyDev')}</span>
      )}
      {dialog === 'roles' && <RolesDialog s={s} grantable={grantable} actorRoles={actorRoles} onClose={() => setDialog(null)} />}
      {dialog === 'reset' && <InviteStaff onClose={() => setDialog(null)} grantable={grantable} actorRoles={actorRoles} target={s} />}
    </section>
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

function RolesDialog({ s, grantable, actorRoles, onClose }: { s: StaffAccount; grantable: string[]; actorRoles: string[]; onClose: () => void }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [roles, setRoles] = useState<string[]>(s.roles);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (roles.length === 0) return setErr(t('staff.pickRole'));
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      await data.updateStaffAccount({ ...actor, roles: actorRoles }, s, { roles });
      toast(t('staff.saved'), 'success');
      onClose();
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`${t('staff.editRoles')} — ${s.displayName}`}>
      <form className="stack" onSubmit={save} noValidate>
        <RoleChips grantable={grantable} value={roles} onChange={setRoles} />
        {err && <span className="error" role="alert">{err}</span>}
        <button className="btn btn-primary" disabled={busy} aria-busy={busy}>{t('app.save')}</button>
      </form>
    </Modal>
  );
}

/** New staff invite, or (with `target`) a new-password link for an existing staff account. */
function InviteStaff({ onClose, grantable, actorRoles, developer, target }: { onClose: () => void; grantable: string[]; actorRoles: string[]; developer?: boolean; target?: StaffAccount }) {
  const { t, lang } = useApp();
  const gym = useGym();
  const actor = useActor();
  const errText = useErrorText();
  const [name, setName] = useState(target?.displayName ?? '');
  const [phone, setPhone] = useState(target ? '0' + target.phone.slice(3) : '');
  const [roles, setRoles] = useState<string[]>(target?.roles ?? (developer ? ['admin'] : []));
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (roles.length === 0) return setErr(t('staff.pickRole'));
    if (demoMode) return setUrl('https://pulse-gym.web.app/#/activate?c=…');
    setBusy(true);
    try {
      const r = await data.createStaffInvite({ ...actor, roles: actorRoles }, { phone, displayName: name, roles, purpose: target ? 'reset' : 'activate', target });
      setUrl(r.url);
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };

  const gymName = lang === 'ar' ? gym.nameAr : gym.nameEn;
  const text = url ? (target ? t('invite.waReset', { name, gym: gymName, url }) : t('invite.waStaff', { name, gym: gymName, roles: roleLabel(t, roles), url })) : '';

  return (
    <Modal open onClose={onClose} title={target ? `${t('staff.reset')} — ${target.displayName}` : developer ? t('staff.inviteAdmin') : t('staff.invite')}>
      {url ? (
        <div className="stack">
          <Notice icon="check">{t('staff.linkReady')}</Notice>
          <ShareText text={text} phone={target?.phone ?? ('+20' + phone.replace(/\D/g, '').replace(/^0/, ''))} />
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
