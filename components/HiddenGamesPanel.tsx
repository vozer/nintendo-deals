'use client';

import { useState } from 'react';
import { NintendoGame } from '@/lib/types';

interface HiddenGamesPanelProps {
  hiddenIds: string[];
  allGames: NintendoGame[];
  onUnhide: (gameId: string) => void;
}

export default function HiddenGamesPanel({ hiddenIds, allGames, onUnhide }: HiddenGamesPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (hiddenIds.length === 0) return null;

  const hiddenGames = allGames.filter((g) => hiddenIds.includes(g.fs_id));

  return (
    <div className="bg-white rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>
          {hiddenIds.length} hidden game{hiddenIds.length !== 1 ? 's' : ''}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 divide-y divide-gray-50">
          {hiddenGames.map((game) => (
            <div key={game.fs_id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={game.image_url_sq_s}
                  alt=""
                  className="w-8 h-8 rounded object-cover shrink-0"
                />
                <span className="text-sm text-gray-700 truncate">{game.title}</span>
              </div>
              <button
                onClick={() => onUnhide(game.fs_id)}
                className="text-xs text-blue-600 font-medium hover:text-blue-700 shrink-0 ml-2"
              >
                Unhide
              </button>
            </div>
          ))}
          {hiddenIds.length > hiddenGames.length && (
            <div className="px-4 py-2.5 text-xs text-gray-400">
              +{hiddenIds.length - hiddenGames.length} more hidden (not in current results)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
