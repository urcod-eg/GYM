import { describe, expect, it } from 'vitest';
import { INBOX_CHUNK, noticeForMember, sendNotice } from './notices';
import { WriteError } from './writes';

describe('notices', () => {
  const base = { title: 'تغيير المواعيد', body: 'من السبت', audience: 'ALL' as const, memberIds: ['x'] };
  it('public notices have no copies; chosen-member ones are split into small writes', () => {
    const a = sendNotice({ actorUid: 'a', auditId: 'au', noticeId: 'n1', input: base });
    expect(a.rest).toHaveLength(0);
    expect(a.first[0].data).toMatchObject({ public: true, recipients: 0 });
    const ids = Array.from({ length: 7 }, (_, i) => `m${i}`);
    const b = sendNotice({ actorUid: 'a', auditId: 'au', noticeId: 'n2', input: { ...base, audience: 'LIST', memberIds: [...ids, 'm0'] } });
    expect(b.first[0].data).toMatchObject({ public: false, recipients: 7 });
    expect(b.rest.flat()).toHaveLength(7);
    expect(b.rest.every((c) => c.length <= INBOX_CHUNK)).toBe(true);
    expect(b.rest[0][0].path).toBe('inbox/n2_m0');
  });
  it('refuses an empty notice or a chosen-members notice with nobody', () => {
    expect(() => sendNotice({ actorUid: 'a', auditId: 'au', noticeId: 'n3', input: { ...base, title: ' ' } })).toThrow(WriteError);
    expect(() => sendNotice({ actorUid: 'a', auditId: 'au', noticeId: 'n3', input: { ...base, audience: 'LIST', memberIds: [] } })).toThrow(WriteError);
  });
  it('who sees a public notice', () => {
    expect(noticeForMember('ALL', { active: false, vip: false })).toBe(true);
    expect(noticeForMember('ACTIVE', { active: false, vip: true })).toBe(false);
    expect(noticeForMember('VIP', { active: true, vip: false })).toBe(false);
    expect(noticeForMember('VIP', { active: false, vip: true })).toBe(true);
    expect(noticeForMember('LIST', { active: true, vip: true })).toBe(false);
  });
});
