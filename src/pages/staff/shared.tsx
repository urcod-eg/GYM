import { DateTime } from 'luxon';
import { GYM_TZ, lastUsableDay, phaseAt } from '../../domain/dates';
import { matchesQuery } from '../../domain/text';
import { DEMO_COACHES, DEMO_MEMBERS, memberDates, planById, type DemoMember } from '../../mock/demo';

export interface MemberRow {
  m: DemoMember;
  phase: ReturnType<typeof phaseAt>;
  lastDay: DateTime;
  start: DateTime;
  end: DateTime;
  planAr: string;
  planEn: string;
  coach: string | null;
}

export function memberRows(): MemberRow[] {
  const now = DateTime.now().setZone(GYM_TZ);
  return DEMO_MEMBERS.map((m) => {
    const { start, end } = memberDates(m);
    const plan = planById(m.planId);
    return {
      m,
      start,
      end,
      phase: phaseAt(now, start, end),
      lastDay: lastUsableDay(end),
      planAr: plan.nameAr,
      planEn: plan.nameEn,
      coach: DEMO_COACHES.find((c) => c.id === m.coachId)?.name ?? null,
    };
  });
}

export function searchRows(rows: MemberRow[], q: string) {
  return rows.filter((r) => matchesQuery([r.m.name, r.m.phone, '0' + r.m.phone.slice(3), r.m.code], q));
}
