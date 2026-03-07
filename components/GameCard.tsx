'use client';

import { NintendoGame, Preferences, GameRating, GameMedia } from '@/lib/types';

interface GameCardProps {
  game: NintendoGame;
  preferences: Preferences;
  rating?: GameRating;
  media?: GameMedia;
  onHide: (gameId: string) => void;
  onWatch: (gameId: string, threshold: 2 | 5 | 10, title: string) => void;
  hideLabel?: string;
  onUnwatch?: (gameId: string) => void;
  onOpenDetail?: (game: NintendoGame) => void;
  onThink?: (gameId: string) => void;
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

function ratingColor(score: number): string {
  if (score >= 75) return 'text-green-600';
  if (score >= 50) return 'text-yellow-600';
  return 'text-red-500';
}

function ratingBg(score: number): string {
  if (score >= 75) return 'bg-green-50';
  if (score >= 50) return 'bg-yellow-50';
  return 'bg-red-50';
}

export default function GameCard({ game, preferences, rating, media, onHide, onWatch, hideLabel = 'Hide', onUnwatch, onOpenDetail, onThink }: GameCardProps) {
  const watchEntry = preferences.watchGames[game.fs_id];

  const imageUrl = game.image_url_h2x1_s || game.image_url_h16x9_s || game.image_url_sq_s;
  const nintendoUrl = `https://www.nintendo.com${game.url}`;
  const categories = (game.pretty_game_categories_txt || []).slice(0, 3);

  const watchThresholds: (2 | 5 | 10)[] = [2, 5, 10];

  return (
    <div className="bg-white rounded-2xl overflow-hidden flex flex-col">
      <div
        className={`relative w-full aspect-video bg-gray-200 ${onOpenDetail || (media && media.screenshots.length > 0) ? 'cursor-pointer group' : ''}`}
        onClick={() => onOpenDetail?.(game)}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt={game.title}
            className="w-full h-full object-cover group-hover:brightness-90 transition-all"
            loading="lazy"
          />
        )}
        <div className="absolute top-2 right-2 bg-[#E60012] text-white text-xs font-bold px-2 py-1 rounded-lg">
          -{Math.round(game.price_discount_percentage_f)}%
        </div>
        {rating && rating.total_rating != null && (
          <div className={`absolute top-2 left-2 ${ratingBg(rating.total_rating)} backdrop-blur-sm text-xs font-bold px-2 py-1 rounded-lg flex items-center gap-1`}>
            <span className={ratingColor(rating.total_rating)}>
              ★ {Math.round(rating.total_rating)}
            </span>
          </div>
        )}
        {media && (media.screenshots.length > 0 || media.videos?.some((v) => v.type === 'youtube')) && (
          <div className="absolute bottom-2 left-2 flex gap-1.5 opacity-70 group-hover:opacity-100 transition-opacity">
            {media.screenshots.length > 0 && (
              <span className="bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
                {media.screenshots.length}
              </span>
            )}
            {media.videos?.some((v) => v.type === 'youtube') && (
              <span className="bg-black/60 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                Trailer
              </span>
            )}
          </div>
        )}
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

        {rating && (
          <div className="flex items-center gap-2 flex-wrap">
            {rating.aggregated_rating != null && (
              <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${ratingBg(rating.aggregated_rating)} ${ratingColor(rating.aggregated_rating)}`} title={`Critic score (${rating.aggregated_rating_count} reviews)`}>
                🎬 {Math.round(rating.aggregated_rating)} ({rating.aggregated_rating_count})
              </span>
            )}
            {rating.rating != null && (
              <span
                className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                  rating.rating_count <= 1
                    ? 'bg-orange-50 text-orange-600 border border-orange-200'
                    : `${ratingBg(rating.rating)} ${ratingColor(rating.rating)}`
                }`}
                title={rating.rating_count <= 1 ? `User score based on only ${rating.rating_count} rating — unreliable` : `User score (${rating.rating_count} ratings)`}
              >
                👤 {Math.round(rating.rating)} ({rating.rating_count}){rating.rating_count <= 1 ? ' ⚠' : ''}
              </span>
            )}
            {rating.total_rating != null && rating.aggregated_rating == null && rating.rating != null && rating.rating_count <= 1 && (
              <span className="text-[10px] text-orange-500 font-medium">
                Few reviews
              </span>
            )}
          </div>
        )}

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

          {media?.igdb_url && (
            <a
              href={media.igdb_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-purple-600 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-purple-700 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
              IGDB
            </a>
          )}

          <button
            onClick={() => onHide(game.fs_id)}
            className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-500 text-xs font-medium px-3 py-2 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>
            {hideLabel}
          </button>

          {onThink && (
            <button
              onClick={(e) => { e.stopPropagation(); onThink(game.fs_id); }}
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-2 rounded-lg transition-colors ${
                preferences.thinkingAbout?.includes(game.fs_id)
                  ? 'bg-blue-200 text-blue-800 hover:bg-blue-300'
                  : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
              }`}
              title={preferences.thinkingAbout?.includes(game.fs_id) ? 'Remove from thinking list' : 'Save to think about'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill={preferences.thinkingAbout?.includes(game.fs_id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
            </button>
          )}

          {watchThresholds.map((t) => (
            <button
              key={t}
              onClick={() =>
                watchEntry?.threshold === t && onUnwatch
                  ? onUnwatch(game.fs_id)
                  : onWatch(game.fs_id, t, game.title)
              }
              className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-2 rounded-lg transition-colors ${
                watchEntry?.threshold === t
                  ? 'bg-amber-200 text-amber-800 hover:bg-amber-300'
                  : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
              }`}
              title={
                watchEntry?.threshold === t
                  ? 'Remove watch'
                  : `Watch for price below ${t}€`
              }
            >
              &lt; {t}€
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
