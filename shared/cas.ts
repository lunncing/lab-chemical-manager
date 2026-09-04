export const CAS_FORMAT_ERROR = 'CAS号格式应为 2–7 位数字-2 位数字-1 位校验码';
export const CAS_CHECK_DIGIT_ERROR = 'CAS号校验位不正确';

export function casCheckDigit(digits: string): number {
  let sum = 0;
  for (let index = digits.length - 1, weight = 1; index >= 0; index -= 1, weight += 1) {
    sum += Number(digits[index]) * weight;
  }
  return sum % 10;
}

export function normalizeCasNumber(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('CAS号必须是文本');
  const normalized = value.trim();
  if (!normalized) return null;
  const match = /^(\d{2,7})-(\d{2})-(\d)$/.exec(normalized);
  if (!match) throw new Error(CAS_FORMAT_ERROR);
  if (casCheckDigit(`${match[1]}${match[2]}`) !== Number(match[3])) throw new Error(CAS_CHECK_DIGIT_ERROR);
  return normalized;
}
