'use client';

import { NintendoGame, Preferences, GameRating, GameMedia, SteamRating } from '@/lib/types';
import { bayesianScore } from '@/lib/sort-utils';

interface GameCardProps {
  game: NintendoGame;
  preferences: Preferences;
  rating?: GameRating;
  steam?: SteamRating;
  media?: GameMedia;
  isCurated?: boolean;
  globalMean?: number;
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

export default function GameCard({ game, preferences, rating, steam, media, isCurated, globalMean, onHide, onWatch, hideLabel = 'Hide', onUnwatch, onOpenDetail, onThink }: GameCardProps) {
  const isOnSale = game.price_has_discount_b !== false;
  const watchEntry = preferences.watchGames[game.fs_id];
  
  // Calculate display score (blended if steam available)
  let bs = globalMean != null && rating
    ? bayesianScore(rating.total_rating, rating.rating_count ?? 0, globalMean)
    : undefined;
    
  if (steam && globalMean != null) {
    const steamBs = bayesianScore(steam.score_pct, steam.votes, globalMean);
    if (bs != null && bs >= 0 && steamBs >= 0) {
      bs = (bs + steamBs) / 2;
    } else if (steamBs >= 0) {
      bs = steamBs;
    }
  }

  const imageUrl = game.image_url_h2x1_s || game.image_url_h16x9_s || game.image_url_sq_s;
  const nintendoUrl = `https://www.nintendo.com${game.url}`;
  const categories = (game.pretty_game_categories_txt || []).slice(0, 3);

  const watchThresholds: (2 | 5 | 10)[] = [2, 5, 10];

  return (
    <div className={`rounded-2xl overflow-hidden flex flex-col ${isOnSale ? 'bg-white' : 'bg-gray-50'}`}>
      <div
        className={`relative w-full aspect-video bg-gray-200 ${onOpenDetail || (media && media.screenshots.length > 0) ? 'cursor-pointer group' : ''}`}
        onClick={() => onOpenDetail?.(game)}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt={game.title}
            className={`w-full h-full object-cover group-hover:brightness-90 transition-all ${isOnSale ? '' : 'grayscale-[30%] opacity-80'}`}
            loading="lazy"
          />
        )}
        {isOnSale && game.price_discount_percentage_f ? (
          <div className="absolute top-2 right-2 bg-[#E60012] text-white text-xs font-bold px-2 py-1 rounded-lg">
            -{Math.round(game.price_discount_percentage_f)}%
          </div>
        ) : !isOnSale ? (
          <div className="absolute top-2 right-2 bg-gray-500 text-white text-xs font-bold px-2 py-1 rounded-lg">
            Not on sale
          </div>
        ) : null}
        {isCurated && (
          <div className="absolute top-2 left-2 bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded-lg flex items-center gap-1 shadow-sm z-10">
            <span>🏆 Curated</span>
          </div>
        )}
        {(rating && rating.total_rating != null) || steam ? (
          <div
            className={`absolute top-2 ${isCurated ? 'left-24' : 'left-2'} ${ratingBg(bs != null && bs >= 0 ? bs : (rating?.total_rating ?? 0))} backdrop-blur-sm text-xs font-bold px-2 py-1 rounded-lg flex items-center gap-1`}
            title={bs != null && bs >= 0 ? `Score: ${Math.round(bs)}` : `Rating`}
          >
            <span className={ratingColor(bs != null && bs >= 0 ? bs : (rating?.total_rating ?? 0))}>
              ★ {Math.round(bs != null && bs >= 0 ? bs : (rating?.total_rating ?? 0))}
            </span>
            {(rating?.rating_count ?? 0) > 0 && (
              <span className="text-[10px] font-medium text-gray-500">
                · {rating?.rating_count}
              </span>
            )}
          </div>
        ) : null}
        {steam && (
          <div className="absolute top-10 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M11.979 0C5.668 0 .504 4.936.034 11.134l5.856 2.426 1.76-1.76c-.052-.365-.022-.75.127-1.116.328-.802 1.259-1.191 2.061-.864l2.56-3.66c-.07-.31-.06-.636.052-.942.417-1.018 1.597-1.512 2.615-1.095 1.019.417 1.513 1.596 1.096 2.615-.417 1.018-1.597 1.512-2.615 1.095-.54-.22-.916-.683-1.07-1.188l-2.66 3.804c.28.272.5.61.622 1.002.327.802-.062 1.733-.864 2.06-.802.328-1.733-.062-2.06-.863-.12-.293-.142-.598-.086-.893l-4.757-1.97c1.558 4.28 5.626 7.33 10.59 7.33 6.627 0 12-5.373 12-12S18.606 0 11.979 0z"/></svg>
            {steam.score_pct}% ({steam.votes >= 1000 ? (steam.votes/1000).toFixed(1) + 'k' : steam.votes})
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
          {isOnSale && game.price_discounted_f != null ? (
            <>
              {game.price_regular_f != null && (
                <span className="text-sm text-gray-400 line-through">
                  {game.price_regular_f.toFixed(2)} €
                </span>
              )}
              <span className="text-xl font-extrabold text-[#E60012]">
                {game.price_discounted_f.toFixed(2)} €
              </span>
            </>
          ) : (
            <>
              <span className="text-xl font-extrabold text-gray-600">
                {(game.price_sorting_f ?? game.price_regular_f ?? 0).toFixed(2)} €
              </span>
              <span className="text-xs text-gray-400">full price</span>
            </>
          )}
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
