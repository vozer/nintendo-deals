import { NextRequest, NextResponse } from 'next/server';
import { getPreferences, savePreferences } from '@/lib/blob-storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const prefs = await getPreferences();
    return NextResponse.json(prefs);
  } catch (error) {
    console.error('Failed to read preferences:', error);
    return NextResponse.json(
      { error: 'Failed to read preferences' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const prefs = await getPreferences();

    switch (body.action) {
      case 'hide':
        if (!prefs.hiddenGames.includes(body.gameId)) {
          prefs.hiddenGames.push(body.gameId);
        }
        break;
      case 'unhide':
        prefs.hiddenGames = prefs.hiddenGames.filter(
          (id: string) => id !== body.gameId,
        );
        break;
      case 'watch':
        prefs.watchGames[body.gameId] = {
          threshold: body.threshold,
          title: body.title,
        };
        break;
      case 'unwatch':
        delete prefs.watchGames[body.gameId];
        break;
    }

    await savePreferences(prefs);
    return NextResponse.json(prefs);
  } catch (error) {
    console.error('Failed to update preferences:', error);
    return NextResponse.json(
      { error: 'Failed to update preferences' },
      { status: 500 },
    );
  }
}
