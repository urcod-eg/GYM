import { useGenderMode } from './GenderUI';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { useActor } from '../../app/SessionContext';
import { useLedger } from '../../app/LedgerContext';
import { useErrorText } from '../../app/useErrorText';
import { Icon } from '../../components/Icon';
import { Avatar, Modal, Notice } from '../../components/ui';
import { NOTICE_MAX_RECIPIENTS, type NoticeAudience } from '../../domain/notices';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import type { StringKey } from '../../i18n/strings';
import { searchRows, type MemberRow } from './shared';

const AUDIENCES: NoticeAudience[] = ['ALL', 'ACTIVE', 'VIP', 'MEN', 'LADIES', 'LIST'];

const DEMO_NOTICES: data.NoticeRow[] = [
  { id: 'd1', title: 'تغيير مواعيد الجمعة', body: 'الجيم هيفتح الجمعة الجاية من 2 الضهر لـ 10 بالليل بسبب الصيانة.', audience: 'ALL', public: true, recipients: 0, status: 'PUBLISHED', by: 'demo', at: new Date(Date.now() - 2 * 3600_000), updatedAt: null },
  { id: 'd2', title: 'جلسة قياسات مجانية', body: 'أعضاء VIP: احجز جلسة قياس InBody مجانية من الاستقبال.', audience: 'VIP', public: true, recipients: 0, status: 'PUBLISHED', by: 'demo', at: new Date(Date.now() - 3 * 86_400_000), updatedAt: null },
];
const DEMO_READS: Record<string, number> = { d1: 7, d2: 2 };

/** How many members an audience covers right now (the denominator of "read by"). */
export function audienceSize(rows: MemberRow[], a: NoticeAudience, recipients: number): number {
  if (a === 'LIST') return recipients;
  if (a === 'ACTIVE') return rows.filter((r) => r.phase === 'ACTIVE').length;
  if (a === 'VIP') return rows.filter((r) => r.m.vip !== 'STANDARD').length;
  if (a === 'MEN') return rows.filter((r) => r.m.gender === 'M').length;
  if (a === 'LADIES') return rows.filter((r) => r.m.gender === 'F').length;
  return rows.length;
}

function useNoticesAdmin(): data.NoticeRow[] | null {
  const [rows, setRows] = useState<data.NoticeRow[] | null>(demoMode ? DEMO_NOTICES : null);
  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    data.watchNotices(true, setRows, () => setRows([])).then((u) => (cancelled ? u() : (stop = u)));
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);
  return rows;
}

export function NoticesPage() {
  const { t } = useApp();
  const notices = useNoticesAdmin();
  const [compose, setCompose] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const live = (notices ?? []).filter((n) => n.status === 'PUBLISHED');
  const archived = (notices ?? []).filter((n) => n.status === 'ARCHIVED');
  const list = showArchived ? archived : live;
  return (
    <div className="stack">
      <div className="row-between wrap">
        <div className="stack-sm" style={{ gap: 4 }}>
          <h1 className="page-title">{t('admin.notices')}</h1>
          <p className="muted small">{t('notice.intro')}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCompose(true)}>
          <Icon name="plus" />
          {t('notice.new')}
        </button>
      </div>
      {notices === null ? (
        <p className="muted" aria-busy="true">…</p>
      ) : list.length === 0 ? (
        <p className="muted">{t(showArchived ? 'notice.noArchived' : 'notice.empty')}</p>
      ) : (
        <div className="stack">
          {list.slice(0, 30).map((n, i) => (
            <NoticeCard key={n.id} n={n} countNow={i < 10} />
          ))}
        </div>
      )}
      {archived.length > 0 && (
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowArchived((x) => !x)}>
          {showArchived ? t('notice.showLive') : t('notice.showArchived', { n: archived.length })}
        </button>
      )}
      {compose && <Composer onClose={() => setCompose(false)} />}
    </div>
  );
}

function NoticeCard({ n, countNow }: { n: data.NoticeRow; countNow: boolean }) {
  const { t, fmtDate, fmtTime, fmtNum, toast } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const rows = useLedger().rows ?? [];
  const [count, setCount] = useState<number | null>(demoMode ? (DEMO_READS[n.id] ?? 0) : null);
  const [readers, setReaders] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const total = audienceSize(rows, n.audience, n.recipients);

  const loadCount = () => {
    if (demoMode) return;
    data.countNoticeReads(n.id).then(setCount, () => setCount(null));
  };
  useEffect(() => {
    if (countNow) loadCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.id, countNow]);

  const showReaders = async () => {
    if (demoMode) return setReaders(rows.slice(0, DEMO_READS[n.id] ?? 0).map((r) => r.m.id));
    try {
      const ids = await data.readNoticeReaders(n.id);
      setReaders(ids);
      setCount(ids.length);
    } catch (e) {
      toast(errText(e), 'danger');
    }
  };
  const archive = async () => {
    if (demoMode) return toast(t('app.demoNoSave'));
    setBusy(true);
    try {
      await data.archiveNotice(actor, n.id);
      toast(t('notice.archived'), 'success');
    } catch (e) {
      toast(errText(e), 'danger');
    } finally {
      setBusy(false);
    }
  };
  const nameOf = (id: string) => rows.find((r) => r.m.id === id)?.m;

  return (
    <section className="card stack-sm">
      <div className="row-between wrap" style={{ alignItems: 'flex-start' }}>
        <div className="stack-sm grow" style={{ gap: 4, minWidth: 0 }}>
          <strong style={{ fontSize: '1.05rem' }}>{n.title}</strong>
          <p className="small" style={{ whiteSpace: 'pre-line', margin: 0 }}>{n.body}</p>
        </div>
        <span className={`badge ${n.audience === 'VIP' ? 'badge-vip' : 'badge-info'} no-dot`}>{t(`notice.aud.${n.audience}` as StringKey)}{n.audience === 'LIST' ? ` · ${fmtNum(n.recipients)}` : ''}</span>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="xs muted">{n.at ? `${fmtDate(n.at)} · ${fmtTime(n.at)}` : '…'}</span>
        <span className="grow" />
        <button type="button" className="btn btn-secondary btn-sm" onClick={count === null ? loadCount : showReaders}>
          <Icon name="eye" />
          {count === null ? t('notice.countReads') : t('notice.readBy', { n: fmtNum(count), total: fmtNum(Math.max(total, count)) })}
        </button>
        {n.status === 'PUBLISHED' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={archive} disabled={busy}>
            {t('notice.archive')}
          </button>
        )}
      </div>
      {readers && (
        <Modal open onClose={() => setReaders(null)} title={t('notice.readersTitle', { n: fmtNum(readers.length) })}>
          {readers.length === 0 ? (
            <p className="muted">{t('notice.noReaders')}</p>
          ) : (
            <div className="list">
              {readers.map((id) => {
                const m = nameOf(id);
                return (
                  <div key={id} className="list-item">
                    <Avatar name={m?.name ?? '?'} />
                    <span className="grow">
                      <strong>{m?.name ?? id}</strong>
                      {m && <span className="muted small ltr" style={{ display: 'block' }}>{m.code}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}

function Composer({ onClose }: { onClose: () => void }) {
  const { t, toast, fmtNum } = useApp();
  const actor = useActor();
  const errText = useErrorText();
  const rows = useLedger().rows ?? [];
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<NoticeAudience>('ALL');
  const genderOn = useGenderMode().mode !== 'MIXED';
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const found = useMemo(() => (q.trim() ? searchRows(rows, q.trim()) : rows).slice(0, 40), [rows, q]);
  const size = audience === 'LIST' ? picked.length : audienceSize(rows, audience, 0);
  const ok = title.trim().length >= 2 && body.trim().length >= 1 && (audience !== 'LIST' || (picked.length >= 1 && picked.length <= NOTICE_MAX_RECIPIENTS));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= NOTICE_MAX_RECIPIENTS ? p : [...p, id]));

  const send = async () => {
    if (!ok) return setErr(t('notice.err'));
    if (demoMode) {
      toast(t('app.demoNoSave'));
      return onClose();
    }
    setBusy(true);
    setErr(null);
    try {
      await data.sendNotice(actor, { title, body, audience, memberIds: picked }, (d, total) => setProgress(t('notice.progress', { d: fmtNum(d), total: fmtNum(total) })));
      toast(t('notice.sent'), 'success');
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Modal open onClose={busy ? () => undefined : onClose} title={t('notice.new')}>
      <div className="stack">
        <div className="field">
          <label className="label" htmlFor="nt-title">{t('notice.title')}</label>
          <input id="nt-title" className="input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('notice.titlePh')} />
        </div>
        <div className="field">
          <label className="label" htmlFor="nt-body">{t('notice.body')}</label>
          <textarea id="nt-body" className="input" rows={4} maxLength={500} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('notice.bodyPh')} style={{ padding: 12, lineHeight: 1.7 }} />
          <span className="hint num">{body.length}/500</span>
        </div>
        <div className="field">
          <span className="label" id="nt-aud">{t('notice.audience')}</span>
          <div className="chips" role="group" aria-labelledby="nt-aud">
            {AUDIENCES.filter((a) => genderOn || (a !== 'MEN' && a !== 'LADIES')).map((a) => (
              <button key={a} type="button" className="chip" aria-pressed={audience === a} onClick={() => setAudience(a)}>
                {t(`notice.aud.${a}` as StringKey)}
              </button>
            ))}
          </div>
          <span className="hint">{t('notice.reach', { n: fmtNum(size) })}</span>
        </div>
        {audience === 'LIST' && (
          <section className="card stack-sm" style={{ padding: 10 }}>
            <input className="input" placeholder={t('notice.searchPh')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('notice.searchPh')} />
            <span className="xs muted">{t('notice.picked', { n: fmtNum(picked.length), max: fmtNum(NOTICE_MAX_RECIPIENTS) })}</span>
            <div className="list" style={{ maxHeight: 260, overflowY: 'auto' }}>
              {found.map((r) => (
                <label key={r.m.id} className="list-item" style={{ cursor: 'pointer', padding: '0 6px' }}>
                  <input type="checkbox" checked={picked.includes(r.m.id)} onChange={() => toggle(r.m.id)} />
                  <span className="grow">
                    <strong>{r.m.name}</strong>
                    <span className="muted small ltr" style={{ display: 'block' }}>{r.m.code}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        )}
        <div className="stack-sm">
          <span className="xs muted">{t('notice.preview')}</span>
          <NoticePopupCard title={title || '…'} body={body || '…'} />
        </div>
        {err && <span className="error" role="alert">{err}</span>}
        {progress && <Notice icon="info">{progress}</Notice>}
        <button className="btn btn-primary btn-lg btn-block" disabled={busy || !ok} aria-busy={busy} onClick={send}>
          <Icon name="bell" />
          {t('notice.send', { n: fmtNum(size) })}
        </button>
      </div>
    </Modal>
  );
}

/** The card members see (also the preview in the composer). */
export function NoticePopupCard({ title, body, when }: { title: string; body: string; when?: string }) {
  return (
    <div className="notice-pop">
      <span className="notice-pop-icon" aria-hidden="true">
        <Icon name="bell" />
      </span>
      <div className="stack-sm" style={{ gap: 6, minWidth: 0 }}>
        <strong style={{ fontSize: '1.1rem' }}>{title}</strong>
        <p style={{ whiteSpace: 'pre-line', margin: 0, lineHeight: 1.7 }}>{body}</p>
        {when && <span className="xs muted">{when}</span>}
      </div>
    </div>
  );
}
