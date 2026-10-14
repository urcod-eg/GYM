import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../../app/AppContext';
import { GymLogoButton, UrcodLogo } from '../../components/Brand';
import { Icon } from '../../components/Icon';
import { Footer, Prefs, APP_VERSION } from '../../components/Shell';
import { Modal, Notice, Toasts } from '../../components/ui';
import { HeroStage, mediaUrl, type Figure } from '../../components/Media';
import { normalizeEgyptPhone } from '../../domain/text';
import { isIOS, promptInstall, useInstallState } from '../../app/install';
import { demoMode, firebase } from '../../firebase/client';
import { openInvite, phoneSignIn, readProfile, redeem, setRemember } from '../../firebase/data';
import type { InviteDoc } from '../../domain/writes';
import { useErrorText } from '../../app/useErrorText';
import { homeFor, useSession } from '../../app/SessionContext';
import { useGym } from '../../app/GymContext';
import type { StringKey } from '../../i18n/strings';
import type { MultiFactorError, MultiFactorResolver } from 'firebase/auth';

function AuthFrame({ children, kicker, figure = 'ropes' }: { children: React.ReactNode; kicker?: string; figure?: Figure }) {
  const { lang, applyRoleDefault } = useApp();
  const gym = useGym();
  useEffect(() => applyRoleDefault('dark'), [applyRoleDefault]);
  return (
    <>
      <div className="auth-shell">
        <section className="auth-hero">
          <div className="row-between">
            <div className="row">
              <GymLogoButton size="lg" />
              <div>
                <div className="bold" style={{ fontSize: '1.25rem' }}>{lang === 'ar' ? gym.nameAr : gym.nameEn}</div>
                {lang === 'ar' && <div style={{ color: '#a3a8b5' }} className="small">{gym.nameEn}</div>}
              </div>
            </div>
            <Prefs compact />
          </div>
          <div className="hero-body">
            <div className="hero-copy stack-sm">
              {kicker && <span className="promo-tag">{kicker}</span>}
              <h1 className="display">{lang === 'ar' ? 'أقوى كل يوم' : 'STRONGER EVERY DAY'}</h1>
              <p style={{ color: '#c9ccd5', fontSize: '1.0625rem' }}>{lang === 'ar' ? gym.taglineAr : gym.taglineEn}</p>
            </div>
            <HeroStage figure={figure} />
          </div>
        </section>
        <section className="auth-panel">{children}</section>
      </div>
      <Footer />
      <Toasts />
    </>
  );
}

export function LoginPage() {
  const { t, toast } = useApp();
  const navigate = useNavigate();
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const { canPrompt, installed } = useInstallState();
  const gym = useGym();
  const session = useSession();

  const install = async () => {
    const result = await promptInstall();
    if (result === 'accepted') toast(t('install.accepted'), 'success');
    else if (result === 'dismissed') toast(t('install.dismissed'));
    else setManualOpen(true); // iPhone, unsupported browser, or inside a preview frame
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!normalizeEgyptPhone(phone)) {
      setErr(t('login.invalidPhone'));
      return;
    }
    setErr(null);
    if (demoMode) return toast(t('login.needServer'));
    setBusy(true);
    try {
      // Phone → internal sign-in address (loginAliases), then Firebase Auth checks the password.
      await phoneSignIn('member', phone, pw);
      navigate('/member', { replace: true });
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      {!demoMode && session.user && session.roles.length > 0 && <SignedInNotice />}
      <form className="stack" onSubmit={submit} noValidate>
        <h2 className="page-title">{t('login.title')}</h2>
        <div className="field">
          <label className="label" htmlFor="phone">{t('login.phone')}</label>
          <div className="input-wrap">
            <Icon name="phone" />
            <input id="phone" className="input ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!err} aria-describedby="phone-hint" placeholder="010 1234 5678" style={{ textAlign: 'start' }} />
          </div>
          {err ? <span className="error" id="phone-hint">{err}</span> : <span className="hint" id="phone-hint">{t('login.phoneHint')}</span>}
        </div>
        <div className="field">
          <label className="label" htmlFor="pw">{t('login.password')}</label>
          <div className="input-wrap">
            <Icon name="lock" />
            <input id="pw" className="input" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ paddingInlineEnd: 48 }} />
            <button type="button" className="icon-btn" onClick={() => setShow((s) => !s)} aria-label="show password" style={{ position: 'absolute', insetInlineEnd: 2, top: 2 }}>
              <Icon name="eye" />
            </button>
          </div>
        </div>
        <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy} aria-busy={busy}>{t('login.submit')}</button>
        <button type="button" className="linkish" onClick={() => setSupportOpen(true)}>{t('login.forgot')}</button>
        <div className="divider" />
        <div className="install-row">
          {installed ? (
            <span className="badge badge-success">{t('install.installed')}</span>
          ) : (
            <button type="button" className="btn btn-primary-soft" onClick={install} data-ready={canPrompt || undefined}>
              <Icon name="download" />
              {t('install.app')}
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => setInstallOpen(true)}>
            <Icon name="info" />
            {t('login.install')}
          </button>
        </div>
        <Link to="/about" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>{t('login.about')}</Link>
      </form>

      <Modal open={installOpen} onClose={() => setInstallOpen(false)} title={t('install.title')}>
        <div className="stack">
          <p>{t('install.android')}</p>
          <p>{t('install.ios')}</p>
          <p>{t('install.desktop')}</p>
          {!installed && (
            <button className="btn btn-primary btn-block" onClick={() => { setInstallOpen(false); install(); }}>
              <Icon name="download" />
              {t('install.button')}
            </button>
          )}
        </div>
      </Modal>

      <Modal open={manualOpen} onClose={() => setManualOpen(false)} title={isIOS() ? t('install.iosTitle') : t('install.title')}>
        <div className="stack">
          {isIOS() ? (
            <p>{t('install.iosBody')}</p>
          ) : (
            <>
              <p>{t('install.manualBody')}</p>
              <p>{t('install.android')}</p>
              <p>{t('install.desktop')}</p>
            </>
          )}
        </div>
      </Modal>

      <Modal open={supportOpen} onClose={() => setSupportOpen(false)} title={t('support.title')}>
        <div className="stack">
          <p>{t('support.body')}</p>
          {gym.supportPhone && (
            <a className="btn btn-success btn-block" href={`https://wa.me/${gym.supportPhone.replace('+', '')}`} target="_blank" rel="noreferrer">
              <Icon name="whatsapp" />
              {t('support.whatsapp')}
            </a>
          )}
        </div>
      </Modal>
    </AuthFrame>
  );
}

/** Shown on the sign-in page when someone is already signed in (e.g. the installed app reopened). */
function SignedInNotice() {
  const { t } = useApp();
  const s = useSession();
  const navigate = useNavigate();
  return (
    <div className="card card-flat stack-sm" style={{ marginBottom: 16 }}>
      <span>{t('login.signedInAs', { name: s.profile?.displayName ?? '' })}</span>
      <div className="row wrap">
        <button type="button" className="btn btn-primary" onClick={() => navigate(homeFor(s.roles), { replace: true })}>
          {t('login.goHome')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => s.signOut()}>
          {t('login.switch')}
        </button>
      </div>
    </div>
  );
}

/** Developer: e-mail + password, then the TOTP code from the authenticator app. */
function useDevSignIn(onDone: (roles: string[]) => void) {
  const errText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);

  const mods = () => Promise.all([firebase(), import('firebase/auth')]);
  const finish = async () => {
    const [{ auth }] = await mods();
    const p = await readProfile(auth.currentUser!.uid);
    onDone(p?.status === 'active' ? p.roles : []);
  };
  const signIn = async (email: string, password: string) => {
    setErr(null);
    setBusy(true);
    const [{ auth }, A] = await mods();
    try {
      await A.signInWithEmailAndPassword(auth, email.trim(), password);
      await finish();
    } catch (ex) {
      if ((ex as { code?: string }).code === 'auth/multi-factor-auth-required') setResolver(A.getMultiFactorResolver(auth, ex as MultiFactorError));
      else setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };
  const verify = async (code: string) => {
    if (!resolver) return;
    setErr(null);
    setBusy(true);
    try {
      const { TotpMultiFactorGenerator } = await import('firebase/auth');
      const hint = resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) ?? resolver.hints[0];
      await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim()));
      await finish();
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, needsCode: !!resolver, signIn, verify };
}

function DevForm({ onDone }: { onDone: (roles: string[]) => void }) {
  const { t } = useApp();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const s = useDevSignIn(onDone);
  return (
    <form
      className="stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (demoMode) return onDone(['developer']); // preview: open the console with sample data
        if (s.needsCode) s.verify(code);
        else s.signIn(email, pw);
      }}
    >
      <h2 className="page-title">{t('login.devTitle')}</h2>
      {!s.needsCode ? (
        <>
          <div className="field">
            <label className="label" htmlFor="em">{t('login.devEmail')}</label>
            <input id="em" className="input ltr" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={{ textAlign: 'start' }} />
          </div>
          <div className="field">
            <label className="label" htmlFor="spw">{t('login.password')}</label>
            <input id="spw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="field">
          <label className="label" htmlFor="otp">{t('login.mfaNeeded')}</label>
          <input id="otp" className="input ltr num" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ textAlign: 'center', letterSpacing: '0.3em', fontSize: '1.25rem' }} />
        </div>
      )}
      {s.err && <span className="error" role="alert">{s.err}</span>}
      <button className="btn btn-primary btn-lg btn-block" disabled={s.busy} aria-busy={s.busy}>{s.needsCode ? t('login.verify') : t('login.submit')}</button>
    </form>
  );
}

/** Staff: mobile number + password, exactly like members (the account kind is checked after sign-in). */
function StaffPhoneForm({ title, onDone, demoRoles }: { title: string; onDone: (roles: string[]) => void; demoRoles: string[] }) {
  const { t } = useApp();
  const errText = useErrorText();
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [remember, setRememberChoice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (demoMode) return onDone(demoRoles);
    if (!normalizeEgyptPhone(phone)) return setErr(t('login.invalidPhone'));
    setErr(null);
    setBusy(true);
    try {
      await setRemember(remember);
      const p = await phoneSignIn('staff', phone, pw);
      onDone(p.roles); // the 4-digit code is asked next, on the protected screen
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" noValidate onSubmit={submit}>
      <h2 className="page-title">{title}</h2>
      <div className="field">
        <label className="label" htmlFor="sph">{t('login.phone')}</label>
        <div className="input-wrap">
          <Icon name="phone" />
          <input id="sph" className="input ltr" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010 1234 5678" style={{ textAlign: 'start' }} aria-describedby="sph-hint" />
        </div>
        <span className="hint" id="sph-hint">{t('login.staffHint')}</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="spw">{t('login.password')}</label>
        <div className="input-wrap">
          <Icon name="lock" />
          <input id="spw" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
      </div>
      <label className="check-row" htmlFor="remember">
        <input id="remember" type="checkbox" checked={remember} onChange={(e) => setRememberChoice(e.target.checked)} />
        <span className="stack-sm" style={{ gap: 2 }}>
          <span>{t('login.remember')}</span>
          <span className="hint">{t('login.rememberHint')}</span>
        </span>
      </label>
      {err && <span className="error" role="alert">{err}</span>}
      <button className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>{t('login.submit')}</button>
    </form>
  );
}

export function StaffLoginPage() {
  const { t } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const role = params.get('role') === 'admin' ? 'admin' : 'cashier';
  return (
    <AuthFrame kicker={t(role === 'admin' ? 'role.admin' : 'role.cashier')} figure={role === 'admin' ? 'curl' : 'squat'}>
      <div className="stack">
        <StaffPhoneForm title={t(role === 'admin' ? 'login.staffAdmin' : 'login.staffCashier')} demoRoles={[role]} onDone={(roles) => navigate(homeFor(roles), { replace: true })} />
        <Link to="/" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }}>{t('app.back')}</Link>
      </div>
    </AuthFrame>
  );
}

/** Reached only through the hidden urcod gate. Nothing here grants access: the rules check the developer profile and the second factor. */
export function DevLoginPage() {
  const { t, applyRoleDefault } = useApp();
  const navigate = useNavigate();
  useEffect(() => applyRoleDefault('dark'), [applyRoleDefault]);
  return (
    <>
      <main className="main narrow" style={{ minHeight: '80dvh', display: 'grid', placeItems: 'center' }}>
        <div className="card stack" style={{ width: '100%', maxWidth: 420 }}>
          <img className="dev-gear" src={mediaUrl('gear')} alt="" aria-hidden="true" />
          <div className="row">
            <Icon name="shield" width={28} height={28} style={{ color: 'var(--primary-text)' }} />
            <span className="muted small">{t('login.devMfa')}</span>
          </div>
          <DevForm onDone={(roles) => navigate(roles.includes('developer') ? '/dev' : '/', { replace: true })} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ alignSelf: 'flex-start' }}>
            {t('app.back')}
          </button>
        </div>
      </main>
      <Toasts />
    </>
  );
}

/**
 * Opened from the WhatsApp link: /#/activate?c=<code>. Works for member activation, staff invites and
 * password resets. The person chooses their own password; it creates their sign-in for that phone.
 */
export function ActivatePage() {
  const { t, toast } = useApp();
  const errText = useErrorText();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get('c') ?? '';
  const [invite, setInvite] = useState<InviteDoc | null>(null);
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<InviteDoc | null>(null);
  const weak = pw.length < 8 || !/[A-Za-z\u0600-\u06FF]/.test(pw) || !/\d/.test(pw);

  useEffect(() => {
    if (demoMode || !code) return;
    openInvite(code)
      .then((r) => setInvite(r.invite))
      .catch((e) => setLinkErr(errText(e)));
  }, [code, errText]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) return setErr(t('err.password-too-short'));
    if (weak) return setErr(t('err.password-needs-letter-and-digit'));
    if (pw !== pw2) return setErr(t('act.mismatch'));
    if (demoMode) return toast(t('act.demo'));
    setBusy(true);
    try {
      setDone(await redeem(code, pw));
    } catch (ex) {
      setErr(errText(ex));
    } finally {
      setBusy(false);
    }
  };

  const reset = invite?.purpose === 'reset';
  const roles = invite?.roles.map((r) => t(`role.${r}` as StringKey)).join('، ') ?? '';

  return (
    <AuthFrame figure="flex">
      {!code && !demoMode ? (
        <Notice tone="danger" icon="alert">{t('act.noToken')}</Notice>
      ) : linkErr ? (
        <Notice tone="danger" icon="alert">{linkErr}</Notice>
      ) : done ? (
        <div className="stack">
          <Notice icon="check">{done.kind === 'staff' ? t('act.doneStaff') : t('act.done')}</Notice>
          <button className="btn btn-primary btn-lg btn-block" onClick={() => navigate(homeFor(done.roles), { replace: true })}>{t('act.continue')}</button>
        </div>
      ) : !invite && !demoMode ? (
        <p className="muted" aria-busy="true">{t('act.checking')}</p>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <h2 className="page-title">{reset ? t('act.titleReset') : t('act.titleActivate')}</h2>
          {invite && (
            <div className="card card-flat stack-sm" style={{ gap: 4 }}>
              <strong>{t('act.forName', { name: invite.displayName })}</strong>
              {invite.kind === 'staff' && <span className="small muted">{t('act.staffRoles', { roles })}</span>}
            </div>
          )}
          <p className="muted">{t('act.body')}</p>
          {demoMode && <Notice icon="info">{t('act.demo')}</Notice>}
          <div className="field">
            <label className="label" htmlFor="np">{t('act.password')}</label>
            <input id="np" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby="np-hint" />
            <span className="hint" id="np-hint">{t('act.hint')}</span>
          </div>
          <div className="field">
            <label className="label" htmlFor="np2">{t('act.confirm')}</label>
            <input id="np2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          {err && <span className="error" role="alert">{err}</span>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy} aria-busy={busy}>{t('act.submit')}</button>
        </form>
      )}
    </AuthFrame>
  );
}

export function AboutPage() {
  const { t, applyRoleDefault } = useApp();
  useEffect(() => applyRoleDefault('dark'), [applyRoleDefault]);
  return (
    <>
      <main className="main narrow stack" style={{ paddingTop: 32 }}>
        <div className="row-between">
          <h1 className="page-title">{t('about.title')}</h1>
          <Prefs compact />
        </div>
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center', padding: 32 }}>
          <UrcodLogo height={64} tappable />
          <div className="stack-sm">
            <span className="muted small">{t('about.developer')}</span>
            <strong style={{ fontSize: '1.25rem' }} dir="ltr">Mahmoud Gamal Eldeen</strong>
          </div>
          <div className="grid-2" style={{ width: '100%' }}>
            <div className="card card-flat">
              <div className="muted small">{t('about.phone')}</div>
              <a href="tel:+201508613866" className="bold ltr" style={{ fontSize: '1.125rem' }}>01508613866</a>
            </div>
            <div className="card card-flat">
              <div className="muted small">{t('about.version')}</div>
              <div className="bold ltr" style={{ fontSize: '1.125rem' }}>{APP_VERSION}</div>
            </div>
          </div>
          <Notice>
            <strong>{t('about.support')}: </strong>
            {t('about.supportBody')}
          </Notice>
        </div>
        <Link to="/" className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>{t('app.back')}</Link>
      </main>
      <Footer />
    </>
  );
}
