import { useEffect, useState, type FormEvent } from 'react';
import { multiFactor, sendEmailVerification, TotpMultiFactorGenerator, type TotpSecret } from 'firebase/auth';
import { useApp } from '../../app/AppContext';
import { useGym } from '../../app/GymContext';
import { useActor, useSession } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { Icon } from '../../components/Icon';
import { Shell } from '../../components/Shell';
import { Notice } from '../../components/ui';
import { demoMode, firebase } from '../../firebase/client';
import * as data from '../../firebase/data';
import type { LicenseType } from '../../domain/writes';
import type { StringKey } from '../../i18n/strings';
import { StaffManager } from '../staff/StaffManager';

/**
 * Developer console (urcod only). The security rules accept these writes only from the developer
 * profile in a sign-in that used the second factor. The admin cannot open this page or write these documents.
 */
export function DevConsole() {
  const { t } = useApp();
  const s = useSession();
  const needMfa = !demoMode && !s.mfa;
  return (
    <Shell defaultTheme="dark" showCloud title={t('dev.title')} width="narrow" livePaths={['/dev']}>
      <div className="stack">
        <h1 className="page-title">{t('dev.title')}</h1>
        {demoMode && <Notice icon="info">{t('dev.demo')}</Notice>}
        <Notice icon="info">{t('dev.setupFirst')}</Notice>
        <MfaCard />
        <LicenseCard locked={needMfa} />
        <BrandingCard locked={needMfa} />
        <section className="card">
          {needMfa ? <Notice tone="warning" icon="shield">{t('dev.needMfa')}</Notice> : <StaffManager developer />}
        </section>
      </div>
    </Shell>
  );
}

function MfaCard() {
  const { t, toast } = useApp();
  const errText = useErrorText();
  const s = useSession();
  const enrolled = !demoMode && !!s.user && multiFactor(s.user).enrolledFactors.some((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [verifySent, setVerifySent] = useState(false);
  const unverified = !demoMode && !!s.user && !s.user.emailVerified;

  // Firebase requires a verified e-mail before a second factor can be added.
  const sendVerify = async () => {
    setErr(null);
    try {
      const { auth } = await firebase();
      await sendEmailVerification(auth.currentUser!);
      setVerifySent(true);
    } catch (e) {
      setErr(errText(e));
    }
  };

  const start = async () => {
    setErr(null);
    try {
      const { auth } = await firebase();
      await auth.currentUser!.reload();
      if (!auth.currentUser!.emailVerified) return setErr(t('dev.verifyNeeded'));
      const session = await multiFactor(auth.currentUser!).getSession();
      setSecret(await TotpMultiFactorGenerator.generateSecret(session));
    } catch (e) {
      setErr(errText(e));
    }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!secret) return;
    try {
      const { auth } = await firebase();
      await multiFactor(auth.currentUser!).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim()), 'Authenticator');
      setSecret(null);
      toast(t('dev.mfaDone'), 'success');
    } catch (ex) {
      setErr(errText(ex));
    }
  };

  return (
    <section className="card stack-sm">
      <div className="row-between">
        <h2 className="section-title">{t('dev.mfaTitle')}</h2>
        <span className={`badge ${enrolled ? 'badge-success' : 'badge-warning'}`}>{enrolled ? t('dev.mfaBadgeOn') : t('dev.mfaBadgeOff')}</span>
      </div>
      <p className="small muted">{enrolled ? t('dev.mfaOn') : t('dev.mfaOff')}</p>
      {enrolled && s.mfa && <p className="small">{t('dev.mfaSession')}</p>}
      {enrolled && !s.mfa && <Notice tone="warning" icon="shield">{t('dev.needMfa')}</Notice>}
      {!enrolled && unverified && (
        <div className="stack-sm">
          <p className="small">{t('dev.verifyNeeded')}</p>
          <button type="button" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={sendVerify} disabled={verifySent}>
            {verifySent ? t('dev.verifySent') : t('dev.verifyEmail')}
          </button>
        </div>
      )}
      {!enrolled && !secret && (
        <button className="btn btn-secondary" style={{ alignSelf: 'flex-start' }} disabled={demoMode} onClick={start}>
          <Icon name="shield" />
          {t('dev.mfaStart')}
        </button>
      )}
      {secret && (
        <form className="stack-sm" onSubmit={verify}>
          <p className="small">{t('dev.mfaKey')}</p>
          <code className="ltr" style={{ fontSize: '1.125rem', letterSpacing: '0.12em', wordBreak: 'break-all', padding: 12, background: 'var(--surface-2)', borderRadius: 10 }}>
            {secret.secretKey}
          </code>
          <label className="label" htmlFor="mfa-code">{t('dev.code')}</label>
          <input id="mfa-code" className="input ltr num" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>{t('dev.mfaVerify')}</button>
        </form>
      )}
      {err && <span className="error" role="alert">{err}</span>}
    </section>
  );
}

function LicenseCard({ locked }: { locked: boolean }) {
  const { t, toast, fmtDate } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [current, setCurrent] = useState<data.LicenseDoc | null | undefined>(demoMode ? null : undefined);
  const [type, setType] = useState<LicenseType | 'SUSPEND'>('TRIAL');
  const [days, setDays] = useState(14);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    if (!demoMode) data.readLicense().then(setCurrent).catch(() => setCurrent(null));
  };
  useEffect(load, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      if (type === 'SUSPEND') {
        if (!current) return setErr(t('dev.noLicense'));
        const remaining = current.endsAt ? Math.max(1, Math.ceil((current.endsAt.getTime() - current.startsAt.getTime()) / 86_400_000)) : null;
        await data.writeLicense(actor, { type: current.type, state: 'SUSPENDED', startsAt: current.startsAt, days: remaining, note });
      } else {
        await data.writeLicense(actor, { type, state: 'ACTIVE', startsAt: new Date(), days: type === 'LIFETIME' ? null : days, note });
      }
      toast(t('dev.applied'), 'success');
      load();
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };

  const valid = data.licenseValid(current ?? null);
  const choices: [LicenseType | 'SUSPEND', StringKey][] = [
    ['TRIAL', 'dev.trial'],
    ['FIXED', 'dev.fixed'],
    ['LIFETIME', 'dev.lifetime'],
    ['SUSPEND', 'dev.suspend'],
  ];
  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <div className="row-between wrap">
        <h2 className="section-title">{t('dev.license')}</h2>
        {current && (
          <span className={`badge ${valid ? 'badge-success' : 'badge-danger'}`}>
            {t(`dev.${current.type === 'FIXED' ? 'fixed' : current.type.toLowerCase()}` as StringKey)} · {current.state === 'SUSPENDED' ? t('dev.stateSuspended') : valid ? t('dev.stateActive') : t('dev.expired', { date: fmtDate(current.endsAt!) })}
          </span>
        )}
      </div>
      {current === null && !demoMode && <Notice tone="warning" icon="alert">{t('dev.noLicense')}</Notice>}
      {current && (
        <p className="small muted">
          {current.endsAt ? t(valid ? 'dev.validUntil' : 'dev.expired', { date: fmtDate(current.endsAt) }) : t('dev.lifetime')} · {t('dev.version', { n: current.version })}
        </p>
      )}
      <div className="chips" role="group" aria-label={t('dev.type')}>
        {choices.map(([k, label]) => (
          <button type="button" key={k} className="chip" aria-pressed={type === k} onClick={() => setType(k)}>
            {t(label)}
          </button>
        ))}
      </div>
      {(type === 'TRIAL' || type === 'FIXED') && (
        <div className="field">
          <label className="label" htmlFor="lic-days">{type === 'TRIAL' ? t('dev.days') : t('dev.fixedDays')}</label>
          <input id="lic-days" className="input num" type="number" min={1} max={type === 'TRIAL' ? 60 : 3650} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
      )}
      <div className="field">
        <label className="label" htmlFor="lic-note">{t('dev.note')}</label>
        <input id="lic-note" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {err && <span className="error" role="alert">{err}</span>}
      <button className={`btn ${type === 'SUSPEND' ? 'btn-danger-solid' : 'btn-primary'}`} style={{ alignSelf: 'flex-start' }} disabled={locked || busy} aria-busy={busy}>
        {t('dev.apply')}
      </button>
    </form>
  );
}

function BrandingCard({ locked }: { locked: boolean }) {
  const { t, toast } = useApp();
  const gym = useGym();
  const actor = useActor();
  const errText = useErrorText();
  const [b, setB] = useState<data.GymConfig>({ nameAr: gym.nameAr, nameEn: gym.nameEn, codePrefix: gym.codePrefix, primaryColor: gym.primaryColor, supportPhone: gym.supportPhone ? '0' + gym.supportPhone.slice(3) : '', logoDataUrl: gym.logoDataUrl });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof data.GymConfig>(k: K, v: data.GymConfig[K]) => setB((x) => ({ ...x, [k]: v }));

  // Fill the form once the saved identity arrives.
  useEffect(() => {
    if (gym.configured) setB({ nameAr: gym.nameAr, nameEn: gym.nameEn, codePrefix: gym.codePrefix, primaryColor: gym.primaryColor, supportPhone: gym.supportPhone ? '0' + gym.supportPhone.slice(3) : '', logoDataUrl: gym.logoDataUrl });
  }, [gym]);

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    try {
      set('logoDataUrl', await data.logoToDataUrl(file));
    } catch (ex) {
      setErr(errText(ex));
    }
  };

  return (
    <form
      className="card stack"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        if (demoMode) return toast(t('app.demoNoSave'));
        setBusy(true);
        try {
          await data.writeBranding(actor, b);
          toast(t('dev.brandSaved'), 'success');
        } catch (ex) {
          setErr(errText(ex));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="section-title">{t('dev.branding')}</h2>
      <div className="grid-2">
        <div className="field">
          <label className="label" htmlFor="b-ar">{t('dev.nameAr')}</label>
          <input id="b-ar" className="input" value={b.nameAr} onChange={(e) => set('nameAr', e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="b-en">{t('dev.nameEn')}</label>
          <input id="b-en" className="input" dir="ltr" value={b.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="b-code">{t('dev.codePrefix')}</label>
          <input id="b-code" className="input ltr" maxLength={5} value={b.codePrefix} onChange={(e) => set('codePrefix', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} aria-describedby="b-code-h" />
          <span className="hint" id="b-code-h">{t('dev.codePrefixHint')}</span>
        </div>
        <div className="field">
          <label className="label" htmlFor="b-sup">{t('dev.supportPhone')}</label>
          <input id="b-sup" className="input ltr" inputMode="tel" value={b.supportPhone} onChange={(e) => set('supportPhone', e.target.value)} placeholder="010 1234 5678" style={{ textAlign: 'start' }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="b-p">{t('dev.primary')}</label>
          <input id="b-p" className="input" type="color" value={b.primaryColor} onChange={(e) => set('primaryColor', e.target.value.toUpperCase())} style={{ padding: 4 }} />
        </div>
        <div className="field">
          <label className="label" htmlFor="b-logo">{t('dev.logo')}</label>
          <div className="row" style={{ gap: 12 }}>
            {b.logoDataUrl && <img src={b.logoDataUrl} alt="" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 8, background: 'var(--surface-2)' }} />}
            <input id="b-logo" className="input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickLogo(e.target.files?.[0])} style={{ padding: 8 }} />
          </div>
          <span className="hint">{t('dev.logoHint')}</span>
          {b.logoDataUrl && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set('logoDataUrl', null)}>
              <Icon name="trash" />
              {t('dev.logoRemove')}
            </button>
          )}
        </div>
      </div>
      {err && <span className="error" role="alert">{err}</span>}
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={locked || busy} aria-busy={busy}>
        {t('dev.saveBranding')}
      </button>
    </form>
  );
}
