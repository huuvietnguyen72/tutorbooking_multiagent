import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
// Demo data for MSW, tests and the translation file itself are allowed to contain Vietnamese.
const ALLOWED = [/^api[\\/]schema\.d\.ts$/, /^i18n[\\/]/, /^mocks[\\/]/, /\.test\.tsx?$/, /^test[\\/]/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('i18n (NFR-3): UI text lives only in vi.json', () => {
  it('has no Vietnamese string literals in components', () => {
    const offenders = files(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !ALLOWED.some((re) => re.test(f)))
      .filter((f) => VIETNAMESE.test(readFileSync(join(SRC, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
