import { describe, expect, it } from 'vitest';
import { homeFor, staffAreas } from './SessionContext';

describe('staff areas (job switcher)', () => {
  it('one account with several jobs sees each of them', () => {
    expect(staffAreas(['cashier', 'coach'])).toEqual(['cashier', 'coach']);
    expect(homeFor(['cashier', 'coach'])).toBe('/cashier');
    expect(staffAreas(['accountant', 'coach'])).toEqual(['admin', 'coach']);
    expect(staffAreas(['admin'])).toEqual(['admin', 'cashier', 'coach']);
  });
  it('a single job has nothing to switch to', () => {
    expect(staffAreas(['coach'])).toEqual(['coach']);
    expect(staffAreas(['cashier'])).toEqual(['cashier']);
    expect(staffAreas(['member'])).toEqual([]);
  });
});
