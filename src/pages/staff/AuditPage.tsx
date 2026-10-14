import { useEffect, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Notice } from '../../components/ui';
import { demoMode, firebase } from '../../firebase/client';
import { fromSdk } from '../../firebase/commit';
import type { StringKey } from '../../i18n/strings';

interface AuditRow {
  id: string;
  actorUid: string;
  action: string;
  entityType: string;
  entityId: string;
  at: Date | null;
  summary: Record<string, unknown>;
}

const DEMO: AuditRow[] = [
  { id: 'a1', actorUid: 'cashier', action: 'member.register', entityType: 'members', entityId: 'm12', at: new Date(Date.now() - 3600_000), summary: { memberCode: 'PLS-10012', fullName: 'يوسف عادل' } },
  { id: 'a2', actorUid: 'admin', action: 'member.block', entityType: 'members', entityId: 'm11', at: new Date(Date.now() - 86_400_000), summary: { scope: 'CHECKIN_BLOCK', reasonCode: 'MISCONDUCT' } },
  { id: 'a3', actorUid: 'developer', action: 'license.set', entityType: 'license', entityId: 'main', at: new Date(Date.now() - 3 * 86_400_000), summary: { type: 'TRIAL', state: 'ACTIVE', version: 1 } },
];

/** Last 100 sensitive actions, newest first. Append-only: the rules refuse edits and deletes. */
export function AuditPage() {
  const { t, fmtDate, fmtTime } = useApp();
  const [rows, setRows] = useState<AuditRow[] | null>(demoMode ? DEMO : null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    if (demoMode) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    Promise.all([firebase(), import('firebase/firestore')]).then(([{ db }, fs]) => {
      if (cancelled) return;
      const q = fs.query(fs.collection(db, 'auditLogs'), fs.orderBy('at', 'desc'), fs.limit(100));
      stop = fs.onSnapshot(
        q,
        (s) => setRows(s.docs.map((d) => ({ ...fromSdk<Omit<AuditRow, 'id'>>(d.data()), id: d.id }))),
        () => setError(true),
      );
      // Staff names for the "who" column (admins may read users).
      fs.getDocs(fs.query(fs.collection(db, 'users'), fs.where('kind', 'in', ['staff', 'developer'])))
        .then((s) => setNames(Object.fromEntries(s.docs.map((d) => [d.id, String(d.data().displayName ?? '')]))))
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div className="stack">
      <div className="stack-sm" style={{ gap: 4 }}>
        <h1 className="page-title">{t('audit.title')}</h1>
        <p className="muted small">{t('audit.body')}</p>
      </div>
      {error ? (
        <Notice tone="danger" icon="alert">{t('acc.loadError')}</Notice>
      ) : rows === null ? (
        <p className="muted" aria-busy="true">…</p>
      ) : rows.length === 0 ? (
        <p className="muted">{t('audit.empty')}</p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="table">
            <tbody>
              {rows.map((r) => {
                const key = `audit.${r.action}` as StringKey;
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }} className="small">
                      {r.at ? `${fmtDate(r.at, 'short')} · ${fmtTime(r.at)}` : '—'}
                    </td>
                    <td>
                      <strong>{t(key) === key ? r.action : t(key)}</strong>
                      <div className="muted xs">{Object.values(r.summary ?? {}).map((v) => (Array.isArray(v) ? v.join(', ') : String(v))).join(' · ')}</div>
                    </td>
                    <td className="small">{names[r.actorUid] || (demoMode ? t(`role.${r.actorUid}` as StringKey) : r.actorUid.slice(0, 8))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
