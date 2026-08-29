import type { Purchase, PurchaseWeekSummary } from './types.js';
import type { PurchaseRequestViewMode } from './purchase-view.js';

export function purchaseWeekCatalogPath(weekStart: string): string {
  return `/purchases/catalog/normal?week=${encodeURIComponent(weekStart)}`;
}

export function purchaseWeekOptionLabel(week: PurchaseWeekSummary): string {
  return `${week.isCurrent ? '本周' : '历史'}：${week.weekStart} 至 ${week.weekEnd}（${week.count} 条）`;
}

export function choosePurchaseWeek(weeks: PurchaseWeekSummary[], selectedWeekStart: string): string {
  if (weeks.some(({ weekStart }) => weekStart === selectedWeekStart)) return selectedWeekStart;
  return weeks.find(({ isCurrent }) => isCurrent)?.weekStart ?? weeks[0]?.weekStart ?? '';
}

export function shouldShowPurchaseWeekPanel(mode: PurchaseRequestViewMode): boolean {
  return mode === 'catalog_normal';
}

export function PurchaseWeekPanel({ weeks, selectedWeekStart, purchases, onChange }: {
  weeks: PurchaseWeekSummary[]; selectedWeekStart: string; purchases: Purchase[]; onChange: (weekStart: string) => void;
}) {
  const selected = weeks.find(({ weekStart }) => weekStart === selectedWeekStart);
  const approvedCount = purchases.filter(({ status }) => status === 'approved').length;
  const purchasedCount = purchases.filter(({ status }) => status === 'purchased').length;
  return <section className="purchase-week-panel" aria-label="普通采购周目录">
    <label>采购周次<select value={selectedWeekStart} onChange={(event) => onChange(event.target.value)}>{weeks.map((week) => <option key={week.weekStart} value={week.weekStart}>{purchaseWeekOptionLabel(week)}</option>)}</select></label>
    {selected && <><p>所选周次：{selected.weekStart} 至 {selected.weekEnd}</p><div className="purchase-week-statistics">
      <span>总数</span><strong>{purchases.length}</strong><span>待采购数</span><strong>{approvedCount}</strong><span>已采购数</span><strong>{purchasedCount}</strong>
    </div></>}
  </section>;
}
