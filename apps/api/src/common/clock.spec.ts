import { FixedClock, SystemClock } from './clock';

describe('Clock', () => {
  it('FixedClock is frozen until advanced', () => {
    const clock = new FixedClock(new Date('2030-01-01T00:00:00Z'));
    expect(clock.now().toISOString()).toBe('2030-01-01T00:00:00.000Z');
    clock.advance(15 * 60 * 1000);
    expect(clock.now().toISOString()).toBe('2030-01-01T00:15:00.000Z');
  });

  it('SystemClock tracks real time', () => {
    const before = Date.now();
    expect(new SystemClock().now().getTime()).toBeGreaterThanOrEqual(before);
  });
});
