import { useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { Icon, type IconName } from '../../components/Icon';
import { Avatar } from '../../components/ui';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import type { StaffAccount } from '../../firebase/data';
import { activeBlocks } from '../../domain/writes';
import type { StringKey } from '../../i18n/strings';
import { MemberCard, useLicenseOk, useMembers } from './Accounts';
import { useStaff, useStaffStatus } from './StaffManager';
import { AuditPage, SECURITY_ACTIONS } from './AuditPage';

/**
 * Security & blocks: who is signed in right now, locked or disabled staff accounts,
 * blocked members, and the latest security events. Full staff management stays on the Staff page.
 */
export function SecurityPage() {
  const { t } = useApp();
  const actor = useActor();
  const { rows: staff } = useStaff();
  const status = useStaffStatus();
  const { rows: members } = useMembers();
  const licenseOk = useLicenseOk();
  const now = new Date();

  const all = staff ?? [];
  const online = all.filter((s) => status.sessions[s.uid]);
  const locked = all.filter((s) => status.lockedUids.includes(s.uid));
  const disabled = all.filter((s) => s.status === 'disabled');
  const blocked = (members ?? []).filter((m) => activeBlocks(m.blocks, now).length > 0);

  return (
    <div className="stack">
      <div className="stack-sm" style={{ gap: 4 }}>
        <h1 className="page-title">{t('admin.security')}</h1>
        <p className="muted small">{t('sec.body')}</p>
      </div>

      <div className="sec-stats">
        <Stat icon="user" tone="success" n={online.length} label={t('sec.online')} />
        <Stat icon="lock" tone="danger" n={locked.length} label={t('sec.locked')} />
        <Stat icon="x" tone="warning" n={disabled.length} label={t('sec.disabled')} />
        <Stat icon="alert" tone="danger" n={blocked.length} label={t('sec.blocked')} />
      </div>

      <Section title={t('sec.onlineTitle')} empty={t('sec.onlineEmpty')} loading={staff === null}>
        {online.map((s) => (
          <StaffRow key={s.uid} s={s} self={s.uid === actor.uid} badge={{ text: t('staff.online'), tone: 'success' }} at={status.sessions[s.uid]?.at ?? null} action="end" />
        ))}
      </Section>

      {(locked.length > 0 || disabled.length > 0) && (
        <Section title={t('sec.problemsTitle')}>
          {locked.map((s) => (
            <StaffRow key={'l' + s.uid} s={s} self={s.uid === actor.uid} badge={{ text: t('staff.locked'), tone: 'danger' }} action="unlock" />
          ))}
          {disabled.map((s) => (
            <StaffRow key={'d' + s.uid} s={s} self={s.uid === actor.uid} badge={{ text: t('staff.disabled'), tone: 'warning' }} />
          ))}
        </Section>
      )}

      <Section title={t('sec.blockedTitle')} empty={t('sec.blockedEmpty')} loading={members === null}>
        {blocked.map((m) => (
          <MemberCard key={m.id} m={m} admin canWrite={licenseOk !== false} />
        ))}
      </Section>

      <section className="stack-sm">
        <h2 className="section-title">{t('sec.eventsTitle')}</h2>
        <AuditPage only={SECURITY_ACTIONS} embedded />
      </section>
    </div>
  );
}

function Stat({ icon, tone, n, label }: { icon: IconName; tone: 'success' | 'danger' | 'warning'; n: number; label: string }) {
  return (
    <div className={`card sec-stat tone-${tone}`}>
      <Icon name={icon} />
      <strong className="num">{n}</strong>
      <span className="small muted">{label}</span>
    </div>
  );
}

function Section({ title, empty, loading, children }: { title: string; empty?: string; loading?: boolean; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <section className="stack-sm">
      <h2 className="section-title">{title}</h2>
      {loading ? <p className="muted" aria-busy="true">…</p> : items.length === 0 ? <p className="muted small">{empty}</p> : <div className="stack-sm">{children}</div>}
    </section>
  );
}

function StaffRow({ s, self, badge, at, action }: { s: StaffAccount; self: boolean; badge: { text: string; tone: string }; at?: Date | null; action?: 'end' | 'unlock' }) {
  const { t, toast, fmtTime } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  // Admins act on non-admin accounts only (the rules enforce the same).
  const canAct = !self && action && (actor.roles.includes('developer') || !s.roles.includes('admin'));
  const run = async () => {
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      if (action === 'end') await data.endStaffSessionFor(s);
      else await data.unlockStaffPin(actor, s);
      toast(t('staff.saved'), 'success');
    } catch (ex) {
      toast(errText(ex), 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack-sm" style={{ padding: 14 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Avatar name={s.displayName} />
        <div className="grow stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <strong>{s.displayName}{self ? ` (${t('sec.you')})` : ''}</strong>
          <span className="muted small">
            {s.roles.map((r) => t(`role.${r}` as StringKey)).join('، ')}
            {at ? ` · ${t('sec.since', { time: fmtTime(at) })}` : ''}
          </span>
          <span className={`badge badge-${badge.tone}`} style={{ alignSelf: 'flex-start', marginTop: 4 }}>{badge.text}</span>
        </div>
      </div>
      {canAct && (
        <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={run} disabled={busy} aria-busy={busy}>
          <Icon name={action === 'end' ? 'logout' : 'lock'} />
          {action === 'end' ? t('staff.endSession') : t('staff.unlock')}
        </button>
      )}
    </div>
  );
}
