import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../app/AppContext';
import { useSession } from '../../app/SessionContext';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/ui';
import { noticeForMember } from '../../domain/notices';
import { demoMode } from '../../firebase/client';
import * as data from '../../firebase/data';
import { NoticePopupCard } from '../staff/Notices';

export interface MemberNotice {
  id: string;
  title: string;
  body: string;
  at: Date | null;
}

const POPUP_DAYS = 30;

const DEMO: MemberNotice[] = [
  { id: 'd1', title: 'تغيير مواعيد الجمعة', body: 'الجيم هيفتح الجمعة الجاية من 2 الضهر لـ 10 بالليل بسبب الصيانة.', at: new Date(Date.now() - 2 * 3600_000) },
  { id: 'd2', title: 'جلسة قياسات مجانية', body: 'أعضاء VIP: احجز جلسة قياس InBody مجانية من الاستقبال.', at: new Date(Date.now() - 3 * 86_400_000) },
];

/** The member's notices (public ones meant for them + their own inbox) and which they read. */
function useMemberNotices(opts: { memberId: string | null; active: boolean; vip: boolean; gender: 'M' | 'F' | null; since: Date | null }) {
  const [pub, setPub] = useState<data.NoticeRow[] | null>(null);
  const [mine, setMine] = useState<{ inbox: data.InboxRow[]; reads: Set<string> } | null>(null);
  const [demoReads, setDemoReads] = useState<Set<string>>(() => new Set(['d2']));
  const [local, setLocal] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (demoMode || !opts.memberId) return;
    let stops: (() => void)[] = [];
    let cancelled = false;
    const keep = (u: () => void) => (cancelled ? u() : stops.push(u));
    data.watchNotices(false, setPub, () => setPub([])).then(keep);
    data.watchMyNotices(opts.memberId, (inbox, reads) => setMine({ inbox, reads }), () => setMine({ inbox: [], reads: new Set() })).then(keep);
    return () => {
      cancelled = true;
      stops.forEach((u) => u());
      stops = [];
    };
  }, [opts.memberId]);

  const items = useMemo<MemberNotice[] | null>(() => {
    if (demoMode) return DEMO;
    if (!pub || !mine) return null;
    const since = opts.since?.getTime() ?? 0;
    const a = pub
      .filter((n) => n.status === 'PUBLISHED' && noticeForMember(n.audience, { active: opts.active, vip: opts.vip, gender: opts.gender }))
      // a new member is not greeted with old notices
      .filter((n) => (n.at?.getTime() ?? 0) >= since - 86_400_000)
      .map((n) => ({ id: n.id, title: n.title, body: n.body, at: n.at }));
    const b = mine.inbox.map((x) => ({ id: x.noticeId, title: x.title, body: x.body, at: x.at }));
    return [...a, ...b].sort((x, y) => (y.at?.getTime() ?? 0) - (x.at?.getTime() ?? 0)).slice(0, 30);
  }, [pub, mine, opts.active, opts.vip, opts.gender, opts.since]);

  const reads = demoMode ? demoReads : mine?.reads;
  const isRead = (id: string) => !!reads?.has(id) || local.has(id);
  const unread = (items ?? []).filter((n) => !isRead(n.id));

  const markRead = (id: string) => {
    setLocal((s) => new Set(s).add(id));
    if (demoMode) return setDemoReads((s) => new Set(s).add(id));
    if (opts.memberId && !mine?.reads.has(id)) data.markNoticeRead(opts.memberId, id).catch(() => undefined);
  };
  return { items, unread, isRead, markRead };
}

/** Bell with the unread count (top bar) + the pop-up of unread notices until "OK". */
export function NoticeBell({ memberId, active, vip }: { memberId: string | null; active: boolean; vip: boolean }) {
  const { t, fmtDate, fmtTime } = useApp();
  const session = useSession();
  const since = session.member?.createdAt ?? null;
  const { items, unread, isRead, markRead } = useMemberNotices({ memberId, active, vip, gender: session.member?.gender ?? null, since });
  const [list, setList] = useState(false);
  const [open, setOpen] = useState<MemberNotice | null>(null);
  const shown = useRef(false);

  // Once per visit: the newest unread notice from the last 30 days pops up.
  const recent = unread.filter((n) => !n.at || Date.now() - n.at.getTime() < POPUP_DAYS * 86_400_000);
  const pop = !shown.current && !list && !open && items !== null ? recent[recent.length - 1] ?? null : null;
  const current = open ?? pop;
  const when = (n: MemberNotice) => (n.at ? `${fmtDate(n.at)} · ${fmtTime(n.at)}` : '');

  const ok = () => {
    if (!current) return;
    markRead(current.id);
    setOpen(null);
    // the next unread one shows right after, oldest first; when none is left the pop-ups stop for this visit
    if (recent.filter((n) => n.id !== current.id).length === 0) shown.current = true;
  };

  return (
    <>
      <button type="button" className="icon-btn bell-btn" onClick={() => setList(true)} aria-label={t('notice.bellLabel', { n: unread.length })} title={t('notice.mine')}>
        <Icon name="bell" />
        {unread.length > 0 && <span className="bell-count num">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>
      {/* the top bar creates its own layer, so the dialogs are placed on the page itself */}
      {current && createPortal(
        <Modal open onClose={ok} title={t('notice.fromGym')}>
          <div className="stack">
            <NoticePopupCard title={current.title} body={current.body} when={when(current)} />
            <button className="btn btn-primary btn-lg btn-block" onClick={ok} autoFocus>
              {t('notice.ok')}
            </button>
          </div>
        </Modal>,
        document.body,
      )}
      {list && !current && createPortal(
        <Modal open onClose={() => setList(false)} title={t('notice.mine')}>
          {!items || items.length === 0 ? (
            <p className="muted">{t('notice.none')}</p>
          ) : (
            <div className="stack-sm">
              {items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`notice-row ${isRead(n.id) ? '' : 'unread'}`}
                  onClick={() => {
                    if (!isRead(n.id)) markRead(n.id);
                    setOpen(n);
                  }}
                >
                  <span className="grow" style={{ minWidth: 0 }}>
                    <strong>{n.title}</strong>
                    <span className="small muted notice-row-body">{n.body}</span>
                  </span>
                  <span className="xs muted" style={{ whiteSpace: 'nowrap' }}>{n.at ? fmtDate(n.at) : ''}</span>
                </button>
              ))}
            </div>
          )}
        </Modal>,
        document.body,
      )}
    </>
  );
}
