'use client';

import { NintendoGame, Preferences } from '@/lib/types';

export type PreferenceFeedback = { pending?: boolean; message?: string; error?: boolean };
export interface GamePreferenceActionsProps {
  game: NintendoGame;
  preferences: Preferences;
  onHide: (id: string) => void;
  onWatch: (id: string, threshold: 2 | 5 | 10, title: string) => void;
  onUnwatch?: (id: string) => void;
  onThink?: (id: string) => void;
  feedback?: PreferenceFeedback;
  onRetry?: () => void;
}

export default function GamePreferenceActions({ game, preferences, onHide, onWatch, onUnwatch, onThink, feedback, onRetry }: GamePreferenceActionsProps) {
  const hidden = preferences.hiddenGames.includes(game.fs_id);
  const watch = preferences.watchGames[game.fs_id];
  const thinking = preferences.thinkingAbout.includes(game.fs_id);
  const button = 'rounded-lg px-3 py-2 text-xs font-semibold min-h-10 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E60012]';
  return <div role="group" className="space-y-2" aria-label={`Preferences for ${game.title}`}>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={feedback?.pending} onClick={() => onHide(game.fs_id)} className={`${button} bg-gray-100 text-gray-700`}>{hidden ? 'Unhide' : 'Hide'}</button>
      {onThink && <button type="button" aria-pressed={thinking} disabled={feedback?.pending} onClick={() => onThink(game.fs_id)} className={`${button} ${thinking ? 'bg-blue-200 text-blue-900' : 'bg-blue-50 text-blue-800'}`}>{thinking ? 'Remove Thinking' : 'Thinking'}</button>}
      {([2, 5, 10] as const).map((threshold) => <button key={threshold} type="button" aria-pressed={watch?.threshold === threshold} disabled={feedback?.pending}
        title={watch?.threshold === threshold ? 'Remove alert' : `Alert when price is below ${threshold} EUR`}
        onClick={() => watch?.threshold === threshold && onUnwatch ? onUnwatch(game.fs_id) : onWatch(game.fs_id, threshold, game.title)}
        className={`${button} ${watch?.threshold === threshold ? 'bg-amber-200 text-amber-900' : 'bg-amber-50 text-amber-900'}`}>Alert &lt;{threshold}€</button>)}
      {watch && onUnwatch && <button type="button" disabled={feedback?.pending} onClick={() => onUnwatch(game.fs_id)} className={`${button} bg-gray-100 text-gray-700`}>Remove alert</button>}
    </div>
    <p className="text-xs text-gray-600">{hidden ? 'Hidden' : 'Visible'} · {watch ? `Alert below ${watch.threshold}€` : 'No price alert'}{thinking ? ' · Thinking' : ''}</p>
    <p role="status" aria-live="polite" className={`text-xs ${feedback?.error ? 'text-red-700' : 'text-gray-600'}`}>{feedback?.pending ? 'Saving...' : feedback?.message}</p>
    {feedback?.error && onRetry && <button type="button" onClick={onRetry} className={`${button} bg-red-50 text-red-700`}>Retry action</button>}
  </div>;
}
