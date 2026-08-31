export const revisionEvents = ['chemical:changed', 'purchase:changed', 'audit:created', 'inbound-request:changed', 'registration-invite:changed', 'password-reset-request:changed'] as const;

export const REALTIME_COALESCE_MS = 75;

export function createRevisionScheduler(refresh: () => void, delay = REALTIME_COALESCE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        refresh();
      }, delay);
    },
    cancel() {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
