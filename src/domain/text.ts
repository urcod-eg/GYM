const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const a = ARABIC_INDIC.indexOf(ch);
    return String(a >= 0 ? a : PERSIAN.indexOf(ch));
  });
}

/**
 * Egyptian mobile numbers → E.164 (+201XXXXXXXXX). Returns null when the number is not a valid
 * Egyptian mobile (prefixes 010, 011, 012, 015). Accepts 01…, 201…, +201…, 00201… and Arabic digits.
 */
export function normalizeEgyptPhone(raw: string): string | null {
  let s = toLatinDigits(raw).replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('20')) s = '0' + s.slice(2);
  if (!/^01[0125]\d{8}$/.test(s)) return null;
  return '+20' + s.slice(1);
}

/** Display form for E.164 Egyptian numbers: 010 1234 5678 */
export function formatEgyptPhone(e164: string): string {
  const local = '0' + e164.replace(/^\+20/, '');
  return `${local.slice(0, 3)} ${local.slice(3, 7)} ${local.slice(7)}`;
}

/** Arabic search normalisation: strip diacritics/tatweel, unify alef forms, ة→ه, ى→ي, lower-case Latin. */
export function normalizeForSearch(input: string): string {
  return toLatinDigits(input)
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens stored on a member document (searchTokens) for indexed prefix search, Phase 0 §3. */
export function buildSearchTokens(fullName: string, phoneE164: string, memberCode: string): string[] {
  const words = normalizeForSearch(fullName).split(' ').filter(Boolean);
  const prefixes = new Set<string>();
  for (const w of words) for (let i = 2; i <= Math.min(w.length, 10); i++) prefixes.add(w.slice(0, i));
  const digits = phoneE164.replace(/\D/g, '');
  prefixes.add(digits.slice(-4));
  prefixes.add('0' + digits.slice(2));
  prefixes.add(memberCode.toLowerCase());
  return [...prefixes];
}

export function matchesQuery(haystack: string[], query: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  const qDigits = q.replace(/\D/g, '');
  return haystack.some((h) => {
    const n = normalizeForSearch(h);
    if (n.includes(q)) return true;
    if (qDigits.length >= 3 && n.replace(/\D/g, '').includes(qDigits)) return true;
    return false;
  });
}
