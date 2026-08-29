const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/;
const DATE_IDENTIFIER = /^(\d{4})-(\d{2})-(\d{2})$/;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRealDate(year: number, month: number, day: number): boolean {
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthLengths[month - 1]!;
}

function formatUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function beijingWeekStart(isoTime: string): string {
  const match = ISO_TIMESTAMP.exec(isoTime);
  if (!match || Number(match[4]) > 23 || !isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    throw new Error('ISO 时间无效');
  }
  const instant = new Date(isoTime);
  if (Number.isNaN(instant.getTime())) throw new Error('ISO 时间无效');
  const beijingDate = new Date(instant.getTime() + BEIJING_OFFSET_MS);
  const day = beijingDate.getUTCDay();
  beijingDate.setUTCDate(beijingDate.getUTCDate() - (day === 0 ? 6 : day - 1));
  return formatUtcDate(beijingDate);
}

export function currentBeijingWeekStart(now = new Date()): string {
  return beijingWeekStart(now.toISOString());
}

export function isValidWeekStart(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_IDENTIFIER.exec(value);
  if (!match || !isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) return false;
  return new Date(`${value}T00:00:00Z`).getUTCDay() === 1;
}

export function weekEnd(weekStart: string): string {
  if (!isValidWeekStart(weekStart)) throw new Error('采购周次无效');
  const end = new Date(`${weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return formatUtcDate(end);
}
