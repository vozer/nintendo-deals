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

export async function PUT(req: NextRequest) {
  try {
    const prefs = await req.json();

    if (!prefs || typeof prefs !== 'object' || !Array.isArray(prefs.hiddenGames)) {
      return NextResponse.json(
        { error: 'Invalid preferences format' },
        { status: 400 },
      );
    }

    await savePreferences(prefs);
    return NextResponse.json(prefs);
  } catch (error) {
    console.error('Failed to save preferences:', error);
    return NextResponse.json(
      { error: 'Failed to save preferences' },
      { status: 500 },
    );
  }
}
