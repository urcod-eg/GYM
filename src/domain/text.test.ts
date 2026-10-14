import { describe, expect, it } from 'vitest';
import { buildSearchTokens, formatEgyptPhone, matchesQuery, normalizeEgyptPhone, normalizeForSearch } from './text';

describe('normalizeEgyptPhone', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['0101 234 5678', '+201012345678'],
    ['+201112345678', '+201112345678'],
    ['00201212345678', '+201212345678'],
    ['201512345678', '+201512345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '+201012345678'],
  ])('%s → %s', (raw, e164) => expect(normalizeEgyptPhone(raw)).toBe(e164));

  it.each(['0131234567', '01312345678', '0101234567', '1234', '02123456789', ''])('rejects %s', (raw) =>
    expect(normalizeEgyptPhone(raw)).toBeNull(),
  );

  it('formats for display', () => expect(formatEgyptPhone('+201012345678')).toBe('010 1234 5678'));
});

describe('Arabic search', () => {
  it('unifies alef, taa marbuta and alef maqsura', () => {
    expect(normalizeForSearch('أحمد إسلام آية مصطفى')).toBe('احمد اسلام ايه مصطفي');
  });
  it('strips diacritics', () => expect(normalizeForSearch('مُحَمَّد')).toBe('محمد'));
  it('matches by partial name, phone tail or code', () => {
    const hay = ['أحمد علي', '+201012345678', 'GYM-10025'];
    expect(matchesQuery(hay, 'احمد')).toBe(true);
    expect(matchesQuery(hay, '5678')).toBe(true);
    expect(matchesQuery(hay, '01012345678')).toBe(true);
    expect(matchesQuery(hay, 'gym-10025')).toBe(true);
    expect(matchesQuery(hay, 'محمود')).toBe(false);
  });
  it('builds prefix tokens', () => {
    const t = buildSearchTokens('أحمد علي', '+201012345678', 'GYM-10025');
    expect(t).toContain('اح');
    expect(t).toContain('احمد');
    expect(t).toContain('5678');
    expect(t).toContain('01012345678');
    expect(t).toContain('gym-10025');
  });
});
