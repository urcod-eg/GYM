import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../app/AppContext';
import { useSession } from '../app/SessionContext';
import { useErrorText } from '../app/useErrorText';
import { AppFailure, devSecretIsSet, enterPin, setupDevSecret } from '../firebase/data';
import { devSecretValue, PHRASE_MIN } from '../domain/writes';
import { Icon } from './Icon';
import { Notice, Toasts } from './ui';

/**
 * Second step after the password, on every new sign-in (or after an admin ended the session).
 * Staff: the 4-digit code. Developer: the 4-digit code + a security phrase (set once on first sign-in).
 * Until it is accepted the security rules give the account no powers at all.
 */
export function PinGate() {
  const { t } = useApp();
  const s = useSession();
  const navigate = useNavigate();
  const errText = useErrorText();
  const dev = s.profile?.kind === 'developer';
  const [setUp, setSetUp] = useState<boolean | null>(dev ? null : true);
  const [pin, setPin] = useState('');
  const [phrase, setPhrase] = useState('');
  const [phrase2, setPhrase2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (dev) devSecretIsSet().then(setSetUp).catch(() => setSetUp(true));
  }, [dev]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[0-9]{4}$/.test(pin)) return setErr(t('err.invalid-pin'));
    if (dev && phrase.length < PHRASE_MIN) return setErr(t('err.phrase-short'));
    if (dev && setUp === false && phrase !== phrase2) return setErr(t('act.mismatch'));
    setErr(null);
    setBusy(true);
    try {
      if (dev && setUp === false) {
        await setupDevSecret(pin, phrase);
        setSetUp(true);
      }
      await enterPin(dev ? devSecretValue(pin, phrase) : pin);
    } catch (ex) {
      const reason = ex instanceof AppFailure ? ex.reason : '';
      if (reason.startsWith('pin-wrong:')) setErr(t('pin.wrong', { n: reason.split(':')[1] }));
      else if (reason === 'pin-locked') {
        setLocked(true);
        setErr(t(dev ? 'pin.devLocked' : 'err.pin-locked'));
      } else setErr(errText(ex));
      setPin('');
      setPhrase('');
    } finally {
      setBusy(false);
    }
  };

  const firstTime = dev && setUp === false;
  return (
    <main className="main narrow" style={{ minHeight: '80dvh', display: 'grid', placeItems: 'center' }}>
      <form className="card stack" style={{ width: '100%', maxWidth: 400 }} onSubmit={submit} noValidate>
        <div className="row">
          <Icon name="shield" width={26} height={26} style={{ color: 'var(--primary-text)' }} />
          <h1 className="section-title">{firstTime ? t('pin.devSetupTitle') : t('pin.title')}</h1>
        </div>
        {setUp === null ? (
          <p className="muted" aria-busy="true">…</p>
        ) : (
          <>
            <p className="small muted">{firstTime ? t('pin.devSetupBody') : dev ? t('pin.devBody') : t('pin.body', { name: s.profile?.displayName ?? '' })}</p>
            <div className="field">
              <label className="label" htmlFor="pin">{t('pin.title')}</label>
              <input
                id="pin"
                className="input ltr num"
                type="password"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                value={pin}
                disabled={locked}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                style={{ textAlign: 'center', letterSpacing: '0.6em', fontSize: '1.75rem' }}
                autoFocus
              />
            </div>
            {dev && (
              <div className="field">
                <label className="label" htmlFor="phrase">{t('pin.phrase')}</label>
                <input id="phrase" className="input" type="password" autoComplete="off" value={phrase} disabled={locked} onChange={(e) => setPhrase(e.target.value)} aria-describedby="phrase-h" />
                <span className="hint" id="phrase-h">{t('pin.phraseHint', { n: PHRASE_MIN })}</span>
              </div>
            )}
            {firstTime && (
              <div className="field">
                <label className="label" htmlFor="phrase2">{t('act.confirm')}</label>
                <input id="phrase2" className="input" type="password" autoComplete="off" value={phrase2} onChange={(e) => setPhrase2(e.target.value)} />
              </div>
            )}
            {firstTime && <Notice tone="warning" icon="lock">{t('pin.devSetupWarn')}</Notice>}
            {err && (locked ? <Notice tone="danger" icon="lock">{err}</Notice> : <span className="error" role="alert">{err}</span>)}
            <button className="btn btn-primary btn-lg btn-block" disabled={busy || locked || pin.length !== 4} aria-busy={busy}>
              {firstTime ? t('app.save') : t('login.verify')}
            </button>
          </>
        )}
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => s.signOut().then(() => navigate('/', { replace: true }))}>
          <Icon name="logout" />
          {t('dev.signOut')}
        </button>
      </form>
      <Toasts />
    </main>
  );
}
