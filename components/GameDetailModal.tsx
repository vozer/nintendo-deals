'use client';

import { useCallback, useEffect, useState } from 'react';
import { NintendoGame, GameRating, GameMedia, CuratedEntry } from '@/lib/types';

interface GameDetailModalProps {
  game: NintendoGame;
  rating?: GameRating;
  media?: GameMedia;
  curatedEntry?: CuratedEntry;
  onClose: () => void;
}

export default function GameDetailModal({ game, rating, media, curatedEntry, onClose }: GameDetailModalProps) {
  const [activeScreenshot, setActiveScreenshot] = useState(0);
  const screenshots = media?.screenshots ?? [];
  const youtubeVideo = media?.videos?.find((v) => v.type === 'youtube');
  const [showVideo, setShowVideo] = useState(!!youtubeVideo);
  const igdbUrl = media?.igdb_url;
  const nintendoUrl = `https://www.nintendo.com${game.url}`;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && !showVideo)
        setActiveScreenshot((i) => Math.min(i + 1, screenshots.length - 1));
      if (e.key === 'ArrowLeft' && !showVideo)
        setActiveScreenshot((i) => Math.max(i - 1, 0));
    },
    [onClose, screenshots.length, showVideo],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Media area */}
        <div className="relative w-full aspect-video bg-gray-900 rounded-t-2xl overflow-hidden">
          {showVideo && youtubeVideo?.youtube_url ? (
            <iframe
              src={`${youtubeVideo.youtube_url}?autoplay=1`}
              className="w-full h-full"
              allow="autoplay; encrypted-media"
              allowFullScreen
              title={youtubeVideo.name || 'Game Trailer'}
            />
          ) : screenshots.length > 0 ? (
            <>
              <img
                src={screenshots[activeScreenshot]}
                alt={`${game.title} screenshot ${activeScreenshot + 1}`}
                className="w-full h-full object-contain"
              />

              {screenshots.length > 1 && (
                <>
                  <button
                    onClick={() => setActiveScreenshot((i) => Math.max(i - 1, 0))}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
                    disabled={activeScreenshot === 0}
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => setActiveScreenshot((i) => Math.min(i + 1, screenshots.length - 1))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
                    disabled={activeScreenshot === screenshots.length - 1}
                  >
                    ›
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {screenshots.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setActiveScreenshot(idx)}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          idx === activeScreenshot ? 'bg-white' : 'bg-white/40 hover:bg-white/70'
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <img
              src={game.image_url_h2x1_s || game.image_url_sq_s}
              alt={game.title}
              className="w-full h-full object-cover"
            />
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 left-3 bg-black/60 hover:bg-black/80 text-white w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Media toggle tabs + thumbnail strip */}
        {youtubeVideo && screenshots.length > 0 && (
          <div className="flex bg-gray-100 border-b border-gray-200">
            <button
              onClick={() => setShowVideo(true)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                showVideo ? 'bg-white text-[#E60012] border-b-2 border-[#E60012]' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
              Trailer
            </button>
            <button
              onClick={() => setShowVideo(false)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                !showVideo ? 'bg-white text-[#E60012] border-b-2 border-[#E60012]' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="12" cy="12" r="3"/></svg>
              Screenshots ({screenshots.length})
            </button>
          </div>
        )}

        {!showVideo && screenshots.length > 1 && (
          <div className="flex gap-1 px-4 py-2 bg-gray-100 overflow-x-auto">
            {screenshots.map((url, idx) => (
              <button
                key={idx}
                onClick={() => setActiveScreenshot(idx)}
                className={`shrink-0 w-20 h-12 rounded overflow-hidden border-2 transition-colors ${
                  idx === activeScreenshot ? 'border-[#E60012]' : 'border-transparent hover:border-gray-300'
                }`}
              >
                <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}

        {/* Info section */}
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{game.title}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{game.publisher}</p>
            </div>
            <div className="text-right shrink-0">
              {game.price_has_discount_b !== false && game.price_discounted_f != null ? (
                <>
                  {game.price_regular_f != null && (
                    <div className="text-sm text-gray-400 line-through">
                      {game.price_regular_f.toFixed(2)} €
                    </div>
                  )}
                  <div className="text-2xl font-extrabold text-[#E60012]">
                    {game.price_discounted_f.toFixed(2)} €
                  </div>
                  {game.price_discount_percentage_f != null && (
                    <div className="text-xs font-bold text-[#E60012]">
                      -{Math.round(game.price_discount_percentage_f)}%
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-2xl font-extrabold text-gray-600">
                    {(game.price_sorting_f ?? game.price_regular_f ?? 0).toFixed(2)} €
                  </div>
                  <div className="text-xs font-medium text-gray-400">
                    Not on sale
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Rating */}
          {rating && rating.total_rating != null && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-bold text-gray-700">
                ★ {Math.round(rating.total_rating)}/100
              </span>
              {rating.aggregated_rating != null && (
                <span className="text-xs text-gray-500">
                  Critics: {Math.round(rating.aggregated_rating)}
                </span>
              )}
              {rating.rating != null && (
                <span className="text-xs text-gray-500">
                  Users: {Math.round(rating.rating)}
                </span>
              )}
              {rating.matched_title && (
                <span className="text-xs text-gray-400">
                  ({rating.matched_title})
                </span>
              )}
            </div>
          )}

          {curatedEntry && (
            <div className={`border rounded-xl p-4 space-y-2 ${
              curatedEntry.source === 'ntdeals'
                ? 'bg-blue-50 border-blue-200'
                : 'bg-yellow-50 border-yellow-200'
            }`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-bold ${
                  curatedEntry.source === 'ntdeals' ? 'text-blue-800' : 'text-yellow-800'
                }`}>
                  {curatedEntry.source === 'ntdeals' ? 'NT Deals' : 'NintendoLife Review'}
                </span>
                {curatedEntry.rank && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                    curatedEntry.source === 'ntdeals'
                      ? 'bg-blue-200 text-blue-800'
                      : 'bg-yellow-200 text-yellow-800'
                  }`}>
                    #{curatedEntry.rank}
                  </span>
                )}
                {curatedEntry.metacritic_score != null && (
                  <span className="text-xs font-semibold bg-green-200 text-green-800 px-1.5 py-0.5 rounded">
                    Metacritic {curatedEntry.metacritic_score}
                  </span>
                )}
                {curatedEntry.deal_rating && (
                  <span className="text-xs font-semibold bg-purple-200 text-purple-800 px-1.5 py-0.5 rounded">
                    {curatedEntry.deal_rating}
                  </span>
                )}
              </div>
              {curatedEntry.review && (
                <p className={`text-sm leading-relaxed italic ${
                  curatedEntry.source === 'ntdeals' ? 'text-blue-900' : 'text-yellow-900'
                }`}>&ldquo;{curatedEntry.review}&rdquo;</p>
              )}
              <a
                href={curatedEntry.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 text-xs font-medium transition-colors ${
                  curatedEntry.source === 'ntdeals'
                    ? 'text-blue-700 hover:text-blue-900'
                    : 'text-yellow-700 hover:text-yellow-900'
                }`}
              >
                {curatedEntry.source === 'ntdeals' ? 'View on NT Deals' : 'Read full review on NintendoLife'}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
              </a>
            </div>
          )}

          {game.excerpt && (
            <p className="text-sm text-gray-600 leading-relaxed">{game.excerpt}</p>
          )}

          {/* Links */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <a
              href={nintendoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-[#E60012] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#cc0010] transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
              Nintendo eShop
            </a>
            {igdbUrl && (
              <a
                href={igdbUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 bg-purple-600 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-purple-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                IGDB
              </a>
            )}
            {youtubeVideo && (
              <a
                href={`https://www.youtube.com/watch?v=${youtubeVideo.video_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 bg-red-600 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                YouTube
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
