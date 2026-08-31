import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLatestInventoryRequestGate,
  INVENTORY_SEARCH_DEBOUNCE_MS,
  planInventoryRequests,
  scheduleInventorySearch,
} from './inventory-requests.js';

afterEach(() => vi.useRealTimers());

describe('inventory request planning', () => {
  it('debounces search by exactly 250ms and supports cleanup', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const cancel = scheduleInventorySearch(apply);

    expect(INVENTORY_SEARCH_DEBOUNCE_MS).toBe(250);
    vi.advanceTimersByTime(249);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledTimes(1);

    const cancelled = vi.fn();
    scheduleInventorySearch(cancelled)();
    cancel();
    vi.runAllTimers();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('plans search as chemicals-only while a revision loads all stable resources once', () => {
    expect(planInventoryRequests('search', '盐 酸')).toEqual({
      chemicals: '/chemicals?search=%E7%9B%90%20%E9%85%B8',
      supporting: [],
    });
    expect(planInventoryRequests('revision', '')).toEqual({
      chemicals: '/chemicals',
      supporting: ['/members', '/inbound-requests?scope=incoming', '/inbound-requests?scope=mine'],
    });
  });

  it('aborts an older request and rejects its response after a newer request starts', () => {
    const gate = createLatestInventoryRequestGate();
    const oldRequest = gate.begin();
    const currentRequest = gate.begin();

    expect(oldRequest.signal.aborted).toBe(true);
    expect(oldRequest.isCurrent()).toBe(false);
    expect(currentRequest.signal.aborted).toBe(false);
    expect(currentRequest.isCurrent()).toBe(true);

    currentRequest.cancel();
    expect(currentRequest.signal.aborted).toBe(true);
    expect(currentRequest.isCurrent()).toBe(false);
  });
});
