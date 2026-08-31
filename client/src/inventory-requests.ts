export const INVENTORY_SEARCH_DEBOUNCE_MS = 250;

const supportingInventoryPaths = [
  '/members',
  '/inbound-requests?scope=incoming',
  '/inbound-requests?scope=mine',
] as const;

export function planInventoryRequests(trigger: 'search' | 'revision', search: string): { chemicals: string; supporting: string[] } {
  return {
    chemicals: `/chemicals${search ? `?search=${encodeURIComponent(search)}` : ''}`,
    supporting: trigger === 'revision' ? [...supportingInventoryPaths] : [],
  };
}

export function scheduleInventorySearch(apply: () => void): () => void {
  const timer = setTimeout(apply, INVENTORY_SEARCH_DEBOUNCE_MS);
  return () => clearTimeout(timer);
}

export function createLatestInventoryRequestGate() {
  let active: AbortController | undefined;

  function cancelActive() {
    active?.abort();
    active = undefined;
  }

  return {
    begin() {
      cancelActive();
      const controller = new AbortController();
      active = controller;
      return {
        signal: controller.signal,
        isCurrent: () => active === controller && !controller.signal.aborted,
        cancel: () => {
          controller.abort();
          if (active === controller) active = undefined;
        },
      };
    },
    cancel: cancelActive,
  };
}
