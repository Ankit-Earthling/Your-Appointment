import { describe, expect, it } from 'vitest';
import { isIanaTimezone, localDate, localTimeToUtc, scheduleAllows } from './time.js';
import { hashToken } from './security.js';

describe('branch-local schedule helpers', () => {
  it('recognizes IANA zones and derives branch-local dates from UTC instants', () => {
    expect(isIanaTimezone('Asia/Kolkata')).toBe(true);
    expect(isIanaTimezone('Not/A_Timezone')).toBe(false);
    expect(localDate(new Date('2026-11-12T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-13');
  });

  it('converts local schedule times to UTC and rejects nonexistent DST wall times', () => {
    expect(localTimeToUtc('2026-11-13', 9 * 60, 'Asia/Kolkata')?.toISOString()).toBe(
      '2026-11-13T03:30:00.000Z',
    );
    expect(localTimeToUtc('2026-03-08', 2 * 60 + 30, 'America/New_York')).toBeUndefined();
  });

  it('accepts a variable-duration interval only when it fits within local opening hours', () => {
    const hours = [{ dayOfWeek: 5, opensLocal: '09:00', closesLocal: '17:00' }];
    expect(
      scheduleAllows(
        hours,
        'Asia/Kolkata',
        new Date('2026-11-13T03:30:00Z'),
        new Date('2026-11-13T04:30:00Z'),
      ),
    ).toBe(true);
    expect(
      scheduleAllows(
        hours,
        'Asia/Kolkata',
        new Date('2026-11-13T11:00:00Z'),
        new Date('2026-11-13T11:45:00Z'),
      ),
    ).toBe(false);
  });
});

describe('public credential hashing', () => {
  it('stores a deterministic one-way digest instead of the public credential', () => {
    const raw = 'demo-public-credential';
    const digest = hashToken(raw);
    expect(digest).toHaveLength(64);
    expect(digest).toBe(hashToken(raw));
    expect(digest).not.toContain(raw);
  });
});
