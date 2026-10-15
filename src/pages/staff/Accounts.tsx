import { GenderPicker, useGenderMode } from './GenderUI';
import type { Gender } from '../../domain/gender';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { useGym } from '../../app/GymContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { Icon } from '../../components/Icon';
import { Avatar, Modal, Notice } from '../../components/ui';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import type { MemberDoc } from '../../firebase/data';
import { activeBlocks, BLOCK_SCOPES, IDENTITY_CHECKS, type BlockScope } from '../../domain/writes';
import { formatEgyptPhone, matchesQuery, buildSearchTokens, normalizeEgyptPhone } from '../../domain/text';
import { DEMO_MEMBERS } from '../../mock/demo';
import type { StringKey } from '../../i18n/strings';

/* ---------------------------------------------------------------- data hooks */

function demoMembers(): MemberDoc[] {
  return DEMO_MEMBERS.map((m, i): MemberDoc => ({
    id: m.id,
    memberNo: 10001 + i,
    memberCode: m.code,
    fullName: m.name,
    phoneE164: m.phone,
    authUid: i % 4 === 3 ? null : `u-${m.id}`,
    accountStatus: i % 4 === 3 ? 'PENDING_ACTIVATION' : 'ACTIVE',
    assignedCoachId: m.coachId,
    blocks: m.blocked ? { CHECKIN_BLOCK: { reasonCode: 'MISCONDUCT', note: '', until: null, by: 'demo', at: new Date() } } : {},
    searchTokens: buildSearchTokens(m.name, m.phone, m.code),
    createdAt: null,
  }));
}

export function useMembers() {
  const [rows, setRows] = useState<MemberDoc[] | null>(demoMode ? demoMembers() : null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchMembers(setRows, setError).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return { rows, error };
}

/** Whether the licence lets staff write (the rules refuse otherwise; this only explains why). */
export function useLicenseOk(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(demoMode ? true : null);
  useEffect(() => {
    if (demoMode) return;
    data
      .readLicense()
      .then((l) => setOk(data.licenseValid(l)))
      .catch(() => setOk(null));
  }, []);
  return ok;
}

/* ---------------------------------------------------------------- page */

type Filter = 'all' | 'pending' | 'active' | 'blocked';

export function AccountsPage({ admin, initialFilter = 'all' }: { admin: boolean; initialFilter?: Filter }) {
  const { t, fmtNum } = useApp();
  const { rows, error } = useMembers();
  const licenseOk = useLicenseOk();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [registering, setRegistering] = useState(false);
  const now = new Date();

  const shown = useMemo(() => {
    const list = (rows ?? []).filter((m) => {
      const blocked = activeBlocks(m.blocks, now).length > 0;
      if (filter === 'blocked') return blocked;
      if (filter === 'pending') return m.accountStatus === 'PENDING_ACTIVATION';
      if (filter === 'active') return m.accountStatus === 'ACTIVE' && !blocked;
      return true;
    });
    return q.trim() ? list.filter((m) => matchesQuery(m.searchTokens, q)) : list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, filter]);
  const visible = shown.slice(0, 100);

  const filters: [Filter, StringKey][] = [
    ['all', 'acc.all'],
    ['pending', 'acc.pending'],
    ['active', 'acc.active'],
    ['blocked', 'acc.blocked'],
  ];

  return (
    <div className="stack">
      <div className="row-between wrap">
        <div className="stack-sm" style={{ gap: 4 }}>
          <h1 className="page-title">{t('acc.title')}</h1>
          <p className="muted small">{t('acc.body')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setRegistering(true)} disabled={licenseOk === false}>
          <Icon name="plus" />
          {t('acc.new')}
        </button>
      </div>
      {licenseOk === false && <Notice tone="warning" icon="alert">{t('acc.licenseOff')}</Notice>}
      <div className="input-wrap">
        <Icon name="search" />
        <input className="input" placeholder={t('acc.search')} aria-label={t('acc.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="chips" role="group" aria-label={t('acc.status')}>
        {filters.map(([k, label]) => (
          <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {t(label)}
          </button>
        ))}
      </div>
      {error ? (
        <Notice tone="danger" icon="alert">{t('acc.loadError')}</Notice>
      ) : rows === null ? (
        <p className="muted" aria-busy="true">…</p>
      ) : rows.length === 0 ? (
        <p className="muted">{t('acc.empty')}</p>
      ) : visible.length === 0 ? (
        <p className="muted">{t('app.noResults')}</p>
      ) : (
        <div className="stack-sm">
          {visible.map((m) => (
            <MemberCard key={m.id} m={m} admin={admin} canWrite={licenseOk !== false} />
          ))}
          {shown.length > visible.length && <p className="muted small">{t('acc.shown', { n: fmtNum(visible.length), total: fmtNum(shown.length) })}</p>}
        </div>
      )}
      {registering && <RegisterModal onClose={() => setRegistering(false)} existing={rows ?? []} />}
    </div>
  );
}

/* ---------------------------------------------------------------- one member */

type Dialog = null | 'activate' | 'reset' | 'block';

export function MemberCard({ m, admin, canWrite }: { m: MemberDoc; admin: boolean; canWrite: boolean }) {
  const { t, fmtDate, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [dialog, setDialog] = useState<Dialog>(null);
  const blocks = activeBlocks(m.blocks, new Date()) as BlockScope[];
  const pending = m.accountStatus === 'PENDING_ACTIVATION';

  const lift = async (scope: BlockScope) => {
    if (demoMode) return toast(t('app.demoNoSave'));
    try {
      await data.liftBlock(actor, m, scope, '');
      toast(t('block.lifted'), 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    }
  };

  return (
    <section className="card stack-sm" style={{ padding: 16 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Avatar name={m.fullName} />
        <div className="grow stack-sm" style={{ gap: 2, minWidth: 0 }}>
          <strong>{m.fullName}</strong>
          <span className="muted small">
            <bdi dir="ltr">{m.memberCode} · {formatEgyptPhone(m.phoneE164)}</bdi>
          </span>
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
            <span className={`badge ${pending ? 'badge-warning' : 'badge-success'}`}>{pending ? t('acc.pending') : t('acc.active')}</span>
            {blocks.map((b) => (
              <span key={b} className="badge badge-danger">
                {t(`block.${b}` as StringKey)}
                {m.blocks[b]?.until ? ` · ${t('block.untilDate', { date: fmtDate(new Date(m.blocks[b].until as Date)) })}` : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {pending && (
          <button className="btn btn-success btn-sm" onClick={() => setDialog('activate')} disabled={!canWrite}>
            <Icon name="lock" />
            {t('acc.sendActivation')}
          </button>
        )}
        {admin && !pending && (
          <button className="btn btn-secondary btn-sm" onClick={() => setDialog('reset')} disabled={!canWrite}>
            <Icon name="lock" />
            {t('acc.reset')}
          </button>
        )}
        {admin && (
          <button className="btn btn-secondary btn-sm" onClick={() => setDialog('block')} disabled={!canWrite}>
            <Icon name="shield" />
            {t('acc.block')}
          </button>
        )}
        {admin &&
          blocks.map((b) => (
            <button key={b} className="btn btn-ghost btn-sm" onClick={() => lift(b)} disabled={!canWrite}>
              <Icon name="check" />
              {t('acc.unblock')} · {t(`block.${b}` as StringKey)}
            </button>
          ))}
      </div>
      {dialog === 'activate' && <InviteDialog m={m} purpose="activate" onClose={() => setDialog(null)} />}
      {dialog === 'reset' && <InviteDialog m={m} purpose="reset" onClose={() => setDialog(null)} />}
      {dialog === 'block' && <BlockDialog m={m} onClose={() => setDialog(null)} />}
    </section>
  );
}

/* ---------------------------------------------------------------- register */

function RegisterModal({ onClose, existing }: { onClose: () => void; existing: MemberDoc[] }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const { mode: genderMode } = useGenderMode();
  const [gender, setGender] = useState<Gender | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // One id per form: a retry after a dropped connection finds the first attempt instead of registering twice.
  const [memberId, setMemberId] = useState<string | null>(null);
  const [done, setDone] = useState<MemberDoc | null>(null);

  const e164 = normalizeEgyptPhone(phone);
  const dupe = e164 ? existing.find((x) => x.phoneE164 === e164) : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) return setErr(t('err.invalid-name'));
    if (!e164) return setErr(t('err.invalid-phone'));
    if (dupe) return setErr(t('reg.phoneExists', { name: dupe.fullName, code: dupe.memberCode }));
    if (genderMode !== 'MIXED' && !gender) return setErr(t('gender.required'));
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      const id = memberId ?? (await data.newMemberId());
      setMemberId(id);
      const r = await data.registerMember(actor, { memberId: id, fullName: name, phone, gender });
      if (r.existing) return setErr(t('err.phone-registered'));
      toast(t('acc.registered', { name: name.trim(), code: r.memberCode }), 'success');
      setDone({ id, memberNo: 0, memberCode: r.memberCode, fullName: name.trim(), phoneE164: e164, authUid: null, accountStatus: 'PENDING_ACTIVATION', assignedCoachId: null, blocks: {}, searchTokens: [], createdAt: null });
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };

  if (done) return <InviteDialog m={done} purpose="activate" onClose={onClose} />;

  return (
    <Modal open onClose={onClose} title={t('acc.new')}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label className="label" htmlFor="rn">{t('reg.name')}</label>
          <input id="rn" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" autoFocus />
        </div>
        <div className="field">
          <label className="label" htmlFor="rp">{t('reg.phone')}</label>
          <input id="rp" className="input ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010 1234 5678" style={{ textAlign: 'start' }} />
          {dupe && <span className="error">{t('reg.phoneExists', { name: dupe.fullName, code: dupe.memberCode })}</span>}
        </div>
        {genderMode !== 'MIXED' && <GenderPicker value={gender} onChange={setGender} id="acc-g" required />}
        {err && <span className="error" role="alert">{err}</span>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>
          {t('acc.save')}
        </button>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- invite links */

export function InviteDialog({ m, purpose, onClose, extra }: { m: MemberDoc; purpose: 'activate' | 'reset'; onClose: () => void; extra?: string }) {
  const { t } = useApp();
  const gym = useGym();
  const actor = useActor();
  const errText = useErrorText();
  const [check, setCheck] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setErr(null);
    if (purpose === 'reset' && !check) return setErr(t('err.identity-check-required'));
    if (demoMode) return setPassword('bmtq4827');
    setBusy(true);
    try {
      const r = await data.createMemberLogin(actor, m, purpose, check ?? undefined);
      setPassword(r.password);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };

  // A new member's account is created straight away (once, even under StrictMode); resets wait for the identity check.
  const started = useRef(false);
  useEffect(() => {
    if (purpose === 'activate' && !started.current) {
      started.current = true;
      create();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const appUrl = window.location.href.split('#')[0];
  const text = !password
    ? ''
    : t(purpose === 'activate' ? 'cred.waMember' : 'cred.waReset', { gym: gym.nameAr, name: m.fullName, code: m.memberCode, url: appUrl, phone: formatEgyptPhone(m.phoneE164), password }) + (extra ? `\n\n${extra}` : '');

  return (
    <Modal open onClose={onClose} title={purpose === 'activate' ? t('cred.title') : t('reset.title')}>
      <div className="stack">
        {purpose === 'reset' && !password && (
          <>
            <p className="small">{t('reset.body')}</p>
            <div className="field">
              <span className="label" id="idc">{t('reset.check')}</span>
              <div className="chips" role="group" aria-labelledby="idc">
                {IDENTITY_CHECKS.map((c) => (
                  <button key={c} type="button" className="chip" aria-pressed={check === c} onClick={() => setCheck(c)}>
                    {t(`reset.${c}` as StringKey)}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn btn-primary" onClick={create} disabled={busy} aria-busy={busy}>
              {t('reset.create')}
            </button>
          </>
        )}
        {purpose === 'activate' && !password && !err && <p className="muted" aria-busy="true">{t('cred.creating')}</p>}
        {err && <Notice tone="danger" icon="alert">{err}</Notice>}
        {password && <Credentials phone={m.phoneE164} password={password} text={text} />}
      </div>
    </Modal>
  );
}

/** The new sign-in details, shown once, with the WhatsApp message ready to send. */
export function Credentials({ phone, password, pin, text }: { phone: string; password?: string; pin?: string; text: string }) {
  const { t } = useApp();
  return (
    <>
      <div className="card card-flat stack-sm">
        <div className="row-between">
          <span className="muted small">{t('cred.user')}</span>
          <bdi dir="ltr" className="bold" style={{ whiteSpace: 'nowrap', fontSize: '1.125rem' }}>{formatEgyptPhone(phone)}</bdi>
        </div>
        {password && (
          <div className="row-between">
            <span className="muted small">{t('cred.password')}</span>
            <bdi dir="ltr" className="bold" style={{ fontSize: '1.25rem', letterSpacing: '0.08em' }}>{password}</bdi>
          </div>
        )}
        {pin && (
          <div className="row-between">
            <span className="muted small">{t('cred.pin')}</span>
            <bdi dir="ltr" className="bold" style={{ fontSize: '1.25rem', letterSpacing: '0.3em' }}>{pin}</bdi>
          </div>
        )}
      </div>
      <Notice tone="warning" icon="lock">{t('cred.once')}</Notice>
      <ShareText text={text} phone={phone} />
    </>
  );
}

/** The message, ready to send: opens WhatsApp with the text filled in (the sender presses Send). */
export function ShareText({ text, phone }: { text: string; phone: string }) {
  const { t, toast } = useApp();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('wa.copied'), 'success');
    } catch {
      (document.getElementById('share-text') as HTMLTextAreaElement | null)?.select();
    }
  };
  return (
    <>
      <textarea id="share-text" className="input" readOnly value={text} rows={8} style={{ padding: 12, minHeight: 180, lineHeight: 1.7 }} />
      <p className="small muted">{t('cred.manual')}</p>
      <div className="row wrap">
        <a className="btn btn-success grow" href={`https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
          <Icon name="whatsapp" />
          {t('wa.open')}
        </a>
        <button type="button" className="btn btn-secondary grow" onClick={copy}>
          <Icon name="copy" />
          {t('wa.copy')}
        </button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- blocks */

const REASONS = ['MISCONDUCT', 'DUES', 'MISUSE', 'OTHER'] as const;

function BlockDialog({ m, onClose }: { m: MemberDoc; onClose: () => void }) {
  const { t, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [scope, setScope] = useState<BlockScope>('CHECKIN_BLOCK');
  const [reason, setReason] = useState<(typeof REASONS)[number]>('MISCONDUCT');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const untilDate = scope === 'TEMPORARY_SUSPENSION' ? (until ? new Date(`${until}T23:59:59+02:00`) : null) : null;
    if (scope === 'TEMPORARY_SUSPENSION' && (!untilDate || untilDate <= new Date())) return setErr(t('err.invalid-input'));
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      await data.setBlock(actor, m, scope, reason, note, untilDate);
      toast(t('block.done'), 'success');
      onClose();
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('block.title', { name: m.fullName })}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <span className="label" id="bs">{t('block.scope')}</span>
          <div className="chips" role="group" aria-labelledby="bs">
            {BLOCK_SCOPES.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={scope === s} onClick={() => setScope(s)}>
                {t(`block.${s}` as StringKey)}
              </button>
            ))}
          </div>
        </div>
        {scope === 'TEMPORARY_SUSPENSION' && (
          <div className="field">
            <label className="label" htmlFor="bu">{t('block.until')}</label>
            <input id="bu" className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
        )}
        <div className="field">
          <span className="label" id="br">{t('block.reason')}</span>
          <div className="chips" role="group" aria-labelledby="br">
            {REASONS.map((r) => (
              <button key={r} type="button" className="chip" aria-pressed={reason === r} onClick={() => setReason(r)}>
                {t(`block.reason.${r}` as StringKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="bn">{t('block.note')}</label>
          <input id="bn" className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && <span className="error" role="alert">{err}</span>}
        <button className="btn btn-danger-solid" disabled={busy} aria-busy={busy}>
          {t('block.apply')}
        </button>
      </form>
    </Modal>
  );
}
