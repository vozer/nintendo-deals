'use client';

import { NintendoGame, Preferences } from '@/lib/types';
import { useState } from 'react';

interface GameCardProps {
  game: NintendoGame;
  preferences: Preferences;
  onHide: (gameId: string) => void;
  onWatch: (gameId: string, threshold: 5 | 10, title: string) => void;
  onUnwatch: (gameId: string) => void;
}

const CAT_ES_TO_EN: Record<string, string> = {
  'Acción': 'Action', 'Aventura': 'Adventure', 'Rol (RPG)': 'RPG',
  'Puzle': 'Puzzle', 'Plataformas': 'Platformer', 'Arcade': 'Arcade',
  'Deportes': 'Sports', 'Estrategia': 'Strategy', 'Simulación': 'Simulation',
  'Carreras': 'Racing', 'Disparos (Shooter)': 'Shooter', 'Fiesta': 'Party',
  'Lucha': 'Fighting', 'Música': 'Music', 'Tablero': 'Board Game',
  'Otros': 'Other', 'Salud y forma física': 'Fitness',
};

function translateCat(cat: string): string {
  return CAT_ES_TO_EN[cat] || cat;
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'Action': { bg: 'bg-green-50', text: 'text-green-600' },
  'Adventure': { bg: 'bg-blue-50', text: 'text-blue-600' },
  'RPG': { bg: 'bg-indigo-50', text: 'text-indigo-600' },
  'Puzzle': { bg: 'bg-purple-50', text: 'text-purple-600' },
  'Platformer': { bg: 'bg-orange-50', text: 'text-orange-600' },
  'Arcade': { bg: 'bg-pink-50', text: 'text-pink-600' },
  'Sports': { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  'Strategy': { bg: 'bg-cyan-50', text: 'text-cyan-600' },
  'Simulation': { bg: 'bg-teal-50', text: 'text-teal-600' },
  'Racing': { bg: 'bg-yellow-50', text: 'text-yellow-700' },
  'Shooter': { bg: 'bg-red-50', text: 'text-red-600' },
  'Party': { bg: 'bg-fuchsia-50', text: 'text-fuchsia-600' },
  'Fighting': { bg: 'bg-rose-50', text: 'text-rose-600' },
  'Music': { bg: 'bg-violet-50', text: 'text-violet-600' },
  'Other': { bg: 'bg-gray-100', text: 'text-gray-600' },
  'Board Game': { bg: 'bg-amber-50', text: 'text-amber-600' },
  'Fitness': { bg: 'bg-lime-50', text: 'text-lime-600' },
};

const DEFAULT_COLOR = { bg: 'bg-gray-100', text: 'text-gray-600' };

export default function GameCard({ game, preferences, onHide, onWatch, onUnwatch }: GameCardProps) {
  const [showWatchMenu, setShowWatchMenu] = useState(false);
  const watchEntry = preferences.watchGames[game.fs_id];

  const imageUrl = game.image_url_h2x1_s || game.image_url_h16x9_s || game.image_url_sq_s;
  const nintendoUrl = `https://www.nintendo.com${game.url}`;
  const categories = (game.pretty_game_categories_txt || []).slice(0, 3);

  return (
    <div className="bg-white rounded-2xl overflow-hidden flex flex-col">
      <div className="relative w-full aspect-video bg-gray-200">
        {imageUrl && (
          <img
            src={imageUrl}
            alt={game.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )}
        <div className="absolute top-2 right-2 bg-[#E60012] text-white text-xs font-bold px-2 py-1 rounded-lg">
          -{Math.round(game.price_discount_percentage_f)}%
        </div>
      </div>

      <div className="p-4 flex flex-col gap-2.5 flex-1">
        <h3 className="font-bold text-gray-900 text-base leading-tight line-clamp-2">
          {game.title}
        </h3>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500 font-medium">{game.publisher}</span>
          {categories.length > 0 && <span className="text-gray-300">·</span>}
          {categories.map((cat) => {
            const translated = translateCat(cat);
            const color = CATEGORY_COLORS[translated] || DEFAULT_COLOR;
            return (
              <span
                key={cat}
                className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${color.bg} ${color.text}`}
              >
                {translated}
              </span>
            );
          })}
        </div>

        {game.excerpt && (
          <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">
            {game.excerpt}
          </p>
        )}

        <div className="flex items-baseline gap-2 mt-auto">
          <span className="text-sm text-gray-400 line-through">
            {game.price_regular_f.toFixed(2)} €
          </span>
          <span className="text-xl font-extrabold text-[#E60012]">
            {game.price_discounted_f.toFixed(2)} €
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={nintendoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 bg-[#E60012] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#cc0010] transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            Nintendo
          </a>

          <button
            onClick={() => onHide(game.fs_id)}
            className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-500 text-xs font-medium px-3 py-2 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>
            Hide
          </button>

          <div className="relative">
            <button
              onClick={() => setShowWatchMenu(!showWatchMenu)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors ${
                watchEntry
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill={watchEntry ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
              {watchEntry ? `< ${watchEntry.threshold}€` : 'Watch'}
            </button>

            {showWatchMenu && (
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[120px]">
                <button
                  onClick={() => { onWatch(game.fs_id, 5, game.title); setShowWatchMenu(false); }}
                  className="block w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 rounded-t-lg"
                >
                  Below 5 €
                </button>
                <button
                  onClick={() => { onWatch(game.fs_id, 10, game.title); setShowWatchMenu(false); }}
                  className="block w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
                >
                  Below 10 €
                </button>
                {watchEntry && (
                  <button
                    onClick={() => { onUnwatch(game.fs_id); setShowWatchMenu(false); }}
                    className="block w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-red-50 rounded-b-lg border-t border-gray-100"
                  >
                    Remove watch
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
