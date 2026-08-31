import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRevisionScheduler, REALTIME_COALESCE_MS, revisionEvents } from './realtime-events.js';

afterEach(() => vi.useRealTimers());

describe('client realtime revisions', () => {
  it('refreshes application data for inbound request changes', () => {
    expect(revisionEvents).toContain('inbound-request:changed');
  });

  it('coalesces a 20-event transaction burst into one delayed refresh', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = createRevisionScheduler(refresh);

    expect(REALTIME_COALESCE_MS).toBeGreaterThanOrEqual(50);
    expect(REALTIME_COALESCE_MS).toBeLessThanOrEqual(100);
    for (let index = 0; index < 20; index += 1) scheduler.schedule();

    vi.advanceTimersByTime(REALTIME_COALESCE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending refresh during socket cleanup', () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const scheduler = createRevisionScheduler(refresh);

    scheduler.schedule();
    scheduler.cancel();
    vi.runAllTimers();

    expect(refresh).not.toHaveBeenCalled();
  });
});
