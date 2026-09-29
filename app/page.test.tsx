import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import HomePage from './page';

describe('home page deep links', () => {
  it('awaits the game query before rendering the requested id', async () => {
    const page = await HomePage({
      searchParams: Promise.resolve({ game: '1337462' }),
    } as unknown as Parameters<typeof HomePage>[0]);

    expect((page as ReactElement<{ initialGameId?: string }>).props.initialGameId).toBe('1337462');
  });
});
