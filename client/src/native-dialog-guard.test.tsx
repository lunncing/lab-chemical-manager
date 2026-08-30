import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function productionClientFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionClientFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('production client native-dialog guard', () => {
  it('contains no browser prompt or confirmation calls', () => {
    const sourceRoot = resolve(process.cwd(), 'client', 'src');
    const nativeDialogCall = /\b(?:window\.)?(?:prompt|confirm)\s*\(/g;
    const offenders = productionClientFiles(sourceRoot).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(nativeDialogCall)].map((match) => `${relative(sourceRoot, file)}:${source.slice(0, match.index).split('\n').length}`);
    });
    expect(offenders).toEqual([]);
  });
});
