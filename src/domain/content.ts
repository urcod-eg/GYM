/**
 * Gym content written by the admin: banners (offers and announcements shown in the member app)
 * and VIP tier descriptions. Pure builders, checked again by the security rules.
 */
import { audit, refuse, SERVER_TIME, type WriteOp } from './writes';

export const BANNER_FIGURES = ['curl', 'abs', 'ropes', 'squat', 'flex', 'gear'] as const;
export type BannerFigure = (typeof BANNER_FIGURES)[number];
export const BANNER_TONES = ['primary', 'vip', 'info'] as const;
export type BannerTone = (typeof BANNER_TONES)[number];
export const BANNER_STATUSES = ['PUBLISHED', 'DRAFT', 'ARCHIVED'] as const;
export type BannerStatus = (typeof BANNER_STATUSES)[number];

export interface BannerDoc {
  title: string;
  body: string;
  tag: string;
  tone: BannerTone;
  figure: BannerFigure;
  status: BannerStatus;
  vipOnly: boolean;
  sort: number;
  endsAt: Date | null; // hidden from this instant (null = until archived)
}

const clean = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

export function validBanner(b: BannerDoc): boolean {
  return (
    b.title.length >= 2 &&
    b.title.length <= 60 &&
    b.body.length <= 140 &&
    b.tag.length >= 1 &&
    b.tag.length <= 20 &&
    (BANNER_TONES as readonly string[]).includes(b.tone) &&
    (BANNER_FIGURES as readonly string[]).includes(b.figure) &&
    (BANNER_STATUSES as readonly string[]).includes(b.status) &&
    typeof b.vipOnly === 'boolean' &&
    Number.isInteger(b.sort) &&
    b.sort >= 0 &&
    b.sort <= 1000
  );
}

export function setBanner(i: { actorUid: string; auditId: string; bannerId: string; banner: BannerDoc }): WriteOp[] {
  const b: BannerDoc = { ...i.banner, title: clean(i.banner.title, 60), body: clean(i.banner.body, 140), tag: clean(i.banner.tag, 20) };
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(i.bannerId) || !validBanner(b)) refuse('invalid-input');
  return [
    { type: 'set', path: `banners/${i.bannerId}`, data: { ...b, updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'banner.set', 'banners', i.bannerId, { title: b.title, status: b.status }),
  ];
}

/** Banners a member sees now: published, not ended, VIP-only ones for VIP members, in order. */
export function visibleBanners<T extends BannerDoc>(all: T[], vip: boolean, now: Date): T[] {
  return all.filter((b) => b.status === 'PUBLISHED' && (!b.endsAt || b.endsAt > now) && (!b.vipOnly || vip)).sort((a, b) => a.sort - b.sort);
}

// ---------------------------------------------------------------- VIP tiers (Phase 4)

export const VIP_TIERS = ['PLUS', 'ELITE'] as const;
export type VipTierId = (typeof VIP_TIERS)[number];

export interface VipTierDoc {
  nameAr: string;
  nameEn: string;
  perksAr: string; // one perk per line
  perksEn: string;
}

export function setVipTier(i: { actorUid: string; auditId: string; tier: VipTierId; doc: VipTierDoc }): WriteOp[] {
  const d: VipTierDoc = { nameAr: clean(i.doc.nameAr, 30), nameEn: clean(i.doc.nameEn, 30), perksAr: i.doc.perksAr.trim().slice(0, 600), perksEn: i.doc.perksEn.trim().slice(0, 600) };
  if (!(VIP_TIERS as readonly string[]).includes(i.tier) || !d.nameAr || !d.nameEn) refuse('invalid-input');
  return [
    { type: 'set', path: `vipTiers/${i.tier}`, data: { ...d, updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'vip.tier', 'vipTiers', i.tier, { nameAr: d.nameAr }),
  ];
}

/** Admin sets (or removes) a member's VIP tier. */
export function setMemberVip(i: { actorUid: string; auditId: string; memberId: string; tier: VipTierId | null }): WriteOp[] {
  if (i.tier !== null && !(VIP_TIERS as readonly string[]).includes(i.tier)) refuse('invalid-input');
  return [
    { type: 'update', path: `members/${i.memberId}`, data: { vipTierId: i.tier, updatedAt: SERVER_TIME, lastAuditId: i.auditId } },
    audit(i.auditId, i.actorUid, 'member.vip', 'members', i.memberId, { tier: i.tier ?? 'STANDARD' }),
  ];
}
