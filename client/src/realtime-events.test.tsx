import { describe, expect, it } from 'vitest';
import { revisionEvents } from './realtime-events.js';

describe('client realtime revisions', () => {
  it('refreshes application data for inbound request changes', () => {
    expect(revisionEvents).toContain('inbound-request:changed');
  });
});
