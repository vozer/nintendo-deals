import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isBlockedTitle } from './filters';

const cases = JSON.parse(
  readFileSync(new URL('../shared/content-policy-cases.json', import.meta.url), 'utf8'),
) as Array<{ title: string; blocked: boolean }>;

describe('shared content policy', () => {
  it.each(cases)('classifies "$title" consistently', ({ title, blocked }) => {
    expect(isBlockedTitle(title)).toBe(blocked);
  });
});
