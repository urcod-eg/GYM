import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../../app/AppContext';
import { useGym } from '../../app/GymContext';
import { useActor } from '../../app/SessionContext';
import { useErrorText } from '../../app/useErrorText';
import { Icon } from '../../components/Icon';
import { Shell } from '../../components/Shell';
import { Notice } from '../../components/ui';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import { devSecretValue, PHRASE_MIN, WIPE_WORD, type LicenseType } from '../../domain/writes';
import { AppFailure } from '../../firebase/data';
import type { StringKey } from '../../i18n/strings';
import { StaffManager } from '../staff/StaffManager';

/**
 * Developer console (urcod only). The security rules accept these writes only from the developer
 * profile in a session opened with the code + security phrase. The admin cannot open this page or write these documents.
 */
export function DevConsole() {
  const { t } = useApp();
  return (
    <Shell defaultTheme="dark" showCloud title={t('dev.title')} width="narrow" livePaths={['/dev']}>
      <div className="stack">
        <h1 className="page-title">{t('dev.title')}</h1>
        {demoMode && <Notice icon="info">{t('dev.demo')}</Notice>}
        <Notice icon="info">{t('dev.setupFirst')}</Notice>
        <LicenseCard locked={false} />
        <BrandingCard locked={false} />
        <section className="card">
          <StaffManager developer />
        </section>
        <WipeCard />
      </div>
    </Shell>
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
  // The original file, kept in this session so the home-screen icon is made at full quality.
  const [logoFile, setLogoFile] = useState<File | null>(null);
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
      setLogoFile(file);
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
      <div className="stack-sm" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)' }}>
        <h3 className="bold">{t('dev.appIdTitle')}</h3>
        <p className="small muted">{t('dev.appIdBody')}</p>
        {b.logoDataUrl && !logoFile && <Notice tone="info" icon="info">{t('dev.appIdReupload')}</Notice>}
        <div className="row wrap">
          <button type="button" className="btn btn-secondary btn-sm" disabled={!b.logoDataUrl} onClick={() => exportIcon(logoFile, b.logoDataUrl).catch((ex) => setErr(errText(ex)))}>
            <Icon name="download" />
            gym-icon.png
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => exportConfig(b)}>
            <Icon name="download" />
            gym.config.json
          </button>
        </div>
      </div>
    </form>
  );
}

function saveFile(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** The gym logo as a square 1024×1024 PNG, ready to upload to GitHub as gym-icon.png. */
async function exportIcon(file: File | null, dataUrl: string | null) {
  const source = file ?? (dataUrl ? await (await fetch(dataUrl)).blob() : null);
  if (!source) return;
  const bmp = await createImageBitmap(source);
  const size = 1024;
  const pad = size * 0.04;
  const scale = Math.min((size - 2 * pad) / bmp.width, (size - 2 * pad) / bmp.height);
  const w = bmp.width * scale;
  const h = bmp.height * scale;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (blob) saveFile(blob, 'gym-icon.png');
}

/** gym.config.json with the names saved here, keeping the colours of the current build. */
function exportConfig(b: data.GymConfig) {
  const theme = document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? '#101115';
  const shortName = (b.nameEn.trim() || b.nameAr.trim()).slice(0, 14);
  const cfg = { nameAr: b.nameAr.trim(), nameEn: b.nameEn.trim(), shortName, themeColor: theme, iconBackground: theme };
  saveFile(new Blob([JSON.stringify(cfg, null, 2) + '\n'], { type: 'application/json' }), 'gym.config.json');
}

/**
 * Deletes all members and their sign-ins (for example after a trial period). Staff accounts stay.
 * Needs the developer code + security phrase again, and the confirmation word.
 */
function WipeCard() {
  const { t, toast, fmtNum } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [phrase, setPhrase] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setOpen(false);
    setPin('');
    setPhrase('');
    setWord('');
    setErr(null);
    setProgress(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!/^[0-9]{4}$/.test(pin)) return setErr(t('err.invalid-pin'));
    if (phrase.length < PHRASE_MIN) return setErr(t('err.phrase-short'));
    if (word.trim() !== WIPE_WORD) return setErr(t('wipe.wordWrong', { word: WIPE_WORD }));
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      const c = await data.wipeMemberData(actor, devSecretValue(pin, phrase), (d, total) => setProgress([d, total]));
      toast(t('wipe.done', { n: fmtNum(c.members) }), 'success');
      reset();
    } catch (ex) {
      const reason = ex instanceof AppFailure ? ex.reason : '';
      if (reason.startsWith('pin-wrong:')) setErr(t('pin.wrong', { n: reason.split(':')[1] }));
      else if (reason === 'pin-locked') setErr(t('pin.devLocked'));
      else setErr(errText(ex));
      setPin('');
      setPhrase('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack" style={{ borderColor: 'var(--danger)' }}>
      <div className="row">
        <Icon name="trash" width={24} height={24} style={{ color: 'var(--danger)' }} />
        <h2 className="section-title">{t('wipe.title')}</h2>
      </div>
      <p className="small">{t('wipe.body')}</p>
      <ul className="small muted" style={{ margin: 0, paddingInlineStart: 20 }}>
        <li>{t('wipe.deletes')}</li>
        <li>{t('wipe.keeps')}</li>
      </ul>
      {!open ? (
        <button type="button" className="btn btn-danger" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
          <Icon name="trash" />
          {t('wipe.start')}
        </button>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <Notice tone="danger" icon="alert">{t('wipe.warn')}</Notice>
          <div className="grid-2">
            <div className="field">
              <label className="label" htmlFor="w-pin">{t('pin.title')}</label>
              <input id="w-pin" className="input ltr num" type="password" inputMode="numeric" maxLength={4} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
            <div className="field">
              <label className="label" htmlFor="w-ph">{t('pin.phrase')}</label>
              <input id="w-ph" className="input" type="password" autoComplete="off" value={phrase} onChange={(e) => setPhrase(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label className="label" htmlFor="w-word">{t('wipe.typeWord', { word: WIPE_WORD })}</label>
            <input id="w-word" className="input" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
          </div>
          {progress && <p className="small muted" aria-live="polite">{t('wipe.progress', { done: fmtNum(progress[0]), total: fmtNum(progress[1]) })}</p>}
          {err && <span className="error" role="alert">{err}</span>}
          <div className="row wrap">
            <button className="btn btn-danger" disabled={busy || word.trim() !== WIPE_WORD} aria-busy={busy}>
              <Icon name="trash" />
              {t('wipe.confirm')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={busy}>
              {t('app.cancel')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
