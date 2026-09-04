import { describe, expect, it } from 'vitest';
import { casCheckDigit, normalizeCasNumber } from '../../shared/cas.js';

describe('optional CAS number normalization and validation', () => {
  it('normalizes every empty representation to null and trims valid input', () => {
    expect(normalizeCasNumber(undefined)).toBeNull();
    expect(normalizeCasNumber(null)).toBeNull();
    expect(normalizeCasNumber('')).toBeNull();
    expect(normalizeCasNumber(' \t\r\n ')).toBeNull();
    expect(normalizeCasNumber('  64-17-5  ')).toBe('64-17-5');
  });

  it('implements the CAS right-to-left weighted check digit', () => {
    expect(casCheckDigit('6417')).toBe(5);
    expect(casCheckDigit('773218')).toBe(5);
    expect(casCheckDigit('5000')).toBe(0);
    expect(normalizeCasNumber('75-05-8')).toBe('75-05-8');
    expect(normalizeCasNumber('7732-18-5')).toBe('7732-18-5');
    expect(normalizeCasNumber('50-00-0')).toBe('50-00-0');
  });

  it('rejects malformed segmentation without repairing or inferring a number', () => {
    for (const value of ['1-23-4', '12345678-12-3', '64-1-5', '64-177-5', '64/17/5', '６４-１７-５', 'ethanol']) {
      expect(() => normalizeCasNumber(value), value).toThrow('CAS号格式应为 2–7 位数字-2 位数字-1 位校验码');
    }
    expect(() => normalizeCasNumber(64175)).toThrow('CAS号必须是文本');
  });

  it('rejects a syntactically valid number with the wrong check digit', () => {
    expect(() => normalizeCasNumber('64-17-6')).toThrow('CAS号校验位不正确');
    expect(() => normalizeCasNumber('7732-18-4')).toThrow('CAS号校验位不正确');
  });
});
