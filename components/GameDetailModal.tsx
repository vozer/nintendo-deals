'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import GamePreferenceActions, { GamePreferenceActionsProps } from './GamePreferenceActions';
import GameVideoPlayer from './GameVideoPlayer';
import { mediaUrl, nintendoLink, steamLink, translateCategory, releaseDate } from '@/lib/game-presentation';
import { NintendoGame, GameRating, GameMedia, CuratedEntry, SteamRating } from '@/lib/types';

interface GameDetailModalProps extends GamePreferenceActionsProps {
  game: NintendoGame;
  rating?: GameRating;
  steam?: SteamRating;
  media?: GameMedia;
  curatedEntries?: CuratedEntry[];
  onClose: () => void;
}

export default function GameDetailModal({ game, rating, steam, media, curatedEntries = [], onClose, ...actions }: GameDetailModalProps) {
  const [activeScreenshot, setActiveScreenshot] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const screenshots = (media?.screenshots ?? []).filter(mediaUrl);
  const videos = (media?.videos ?? []).filter((video) => video.type === 'limelight' || video.type === 'steam' || (video.type === 'youtube' && /^[\w-]{11}$/.test(video.video_id)));
  const [activeVideo, setActiveVideo] = useState<number | null>(null);
  const [failedImage, setFailedImage] = useState<string>();
  const showVideo = activeVideo !== null && videos.length > 0;
  const selectedVideo = videos[activeVideo ?? 0];
  const imageIndex = Math.min(activeScreenshot, Math.max(0, screenshots.length - 1));
  const imageSource = media?.asset_sources?.[screenshots[imageIndex]] ?? media?.source;
  const igdbUrl = media?.igdb_url;
  const steamUrl = steamLink(steam, media);
  const nintendoUrl = nintendoLink(game.url);
  const coverImage = game.image_url_h2x1_s || game.image_url_sq_s;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, video, iframe')) return;
      if (!screenshots.length) return;
      if (e.key === 'ArrowRight' && !showVideo)
        setActiveScreenshot((i) => Math.min(i + 1, screenshots.length - 1));
      if (e.key === 'ArrowLeft' && !showVideo)
        setActiveScreenshot((i) => Math.max(i - 1, 0));
    },
    [screenshots.length, showVideo],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousFocusRef.current = previousFocus;
    dialog?.showModal();
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      if (dialog?.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      const opener = previousFocusRef.current;
      if (opener?.isConnected && opener !== document.body) opener.focus();
      if (!opener || opener === document.body || document.activeElement !== opener)
        document.querySelector<HTMLElement>('[data-game-search]')?.focus();
    };
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="game-detail-title"
      className="fixed inset-0 z-50 m-0 flex h-screen w-screen max-h-none max-w-none items-center justify-center border-0 bg-black/70 p-4 backdrop-blur-sm"
      onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <div
        className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Media area */}
        <div className="relative w-full aspect-video bg-gray-900 rounded-t-2xl overflow-hidden">
          {showVideo && selectedVideo ? (
            <GameVideoPlayer key={selectedVideo.video_id} video={selectedVideo} />
          ) : screenshots.length > 0 ? (
            <>
              <Image
                src={failedImage === screenshots[imageIndex] ? coverImage : screenshots[imageIndex]}
                onError={() => setFailedImage(screenshots[imageIndex])}
                alt={`${game.title} screenshot ${imageIndex + 1}`}
                fill
                sizes="(max-width: 768px) 100vw, 896px"
                unoptimized
                className="w-full h-full object-contain"
              />

              {screenshots.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous screenshot"
                    onClick={() => setActiveScreenshot((i) => Math.max(i - 1, 0))}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
                    disabled={activeScreenshot === 0}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label="Next screenshot"
                    onClick={() => setActiveScreenshot((i) => Math.min(i + 1, screenshots.length - 1))}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
                    disabled={imageIndex === screenshots.length - 1}
                  >
                    ›
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                    {screenshots.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        aria-label={`Show screenshot ${idx + 1} of ${game.title}`}
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
            coverImage && <Image
              src={coverImage}
              alt={game.title}
              fill
              sizes="(max-width: 768px) 100vw, 896px"
              unoptimized
              className="w-full h-full object-cover"
            />
          )}

          {/* Close button */}
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close game details"
            onClick={onClose}
            className="absolute top-3 left-3 bg-black/60 hover:bg-black/80 text-white w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          >
            ✕
          </button>
        </div>

        {(screenshots.length > 0 || videos.length > 0) && <div role="group" className="flex flex-wrap gap-2 border-b border-gray-200 bg-gray-50 p-3" aria-label="Media selection">
          {screenshots.length > 0 && <button type="button" aria-pressed={!showVideo} onClick={() => setActiveVideo(null)} className="rounded-lg bg-white px-3 py-2 text-sm text-gray-800">Screenshots ({screenshots.length})</button>}
          {videos.map((video, index) => <button key={video.video_id} type="button" aria-pressed={activeVideo === index} onClick={() => setActiveVideo(index)} className="rounded-lg bg-white px-3 py-2 text-sm text-gray-800">{video.name || ('Video ' + (index + 1))}{video.source === 'steam' ? ' (PC)' : ''}</button>)}
        </div>}
        {screenshots[imageIndex] && !showVideo && <p className="px-4 pt-2 text-xs text-gray-600">{imageSource === 'steam' ? 'Steam screenshot (PC footage)' : imageSource === 'igdb' ? 'IGDB screenshot' : imageSource === 'nintendo' ? 'Nintendo screenshot' : 'Screenshot'}</p>}
        {media?.collection_complete === false && <p className="px-4 pt-2 text-xs text-amber-800">Some source media could not be collected. Showing available media.</p>}

        {!showVideo && screenshots.length > 1 && (
          <div className="flex gap-1 px-4 py-2 bg-gray-100 overflow-x-auto">
            {screenshots.map((url, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`Show screenshot ${idx + 1} of ${game.title}`}
                onClick={() => setActiveScreenshot(idx)}
                className={`relative shrink-0 w-20 h-12 rounded overflow-hidden border-2 transition-colors ${
                  idx === activeScreenshot ? 'border-[#E60012]' : 'border-transparent hover:border-gray-300'
                }`}
              >
                <Image src={url} alt="" fill sizes="80px" unoptimized className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* Info section */}
        <div className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="game-detail-title" className="text-xl font-bold text-gray-900">{game.title}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{game.publisher}</p>
            </div>
            <div className="text-right shrink-0">
              {game.price_has_discount_b !== false && game.price_discounted_f != null ? (
                <>
                  {game.price_regular_f != null && (
                    <div className="text-sm text-gray-500 line-through">
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

          <GamePreferenceActions game={game} {...actions} />
          <p className="text-xs text-gray-600">{game.pretty_game_categories_txt?.map(translateCategory).join(' · ')}{releaseDate(game.pretty_date_s) ? ` · Released ${releaseDate(game.pretty_date_s)}` : ''}</p>

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

          {curatedEntries.map((curatedEntry) => (
            <div className={`border rounded-xl p-4 space-y-2 ${
              curatedEntry.source === 'ntdeals'
                ? 'bg-blue-50 border-blue-200'
                : 'bg-yellow-50 border-yellow-200'
            }`} key={curatedEntry.source}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-bold ${
                  curatedEntry.source === 'ntdeals' ? 'text-blue-800' : 'text-yellow-800'
                }`}>
                  {curatedEntry.source === 'ntdeals' ? 'NT Deals' : 'Nintendo Life Selects'}
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
              </div>
              {curatedEntry.review && (
                <p className={`text-sm leading-relaxed italic ${
                  curatedEntry.source === 'ntdeals' ? 'text-blue-900' : 'text-yellow-900'
                }`}>&ldquo;{curatedEntry.review}&rdquo;</p>
              )}
              {(curatedEntry.source_price_eur != null || curatedEntry.discount_pct != null || curatedEntry.days_remaining != null) && (
                <p className="text-xs font-medium text-gray-700">
                  {curatedEntry.source === 'ntdeals' && (curatedEntry.days_remaining === 0 || game.price_has_discount_b === false) && 'Historical NT Deals offer: '}
                  {curatedEntry.source_price_eur != null && `${curatedEntry.source === 'ntdeals' ? 'NT Deals' : 'Nintendo Life'} price: ${curatedEntry.source_price_eur.toFixed(2)}€`}
                  {curatedEntry.discount_pct != null && ` · ${curatedEntry.discount_pct}% off`}
                  {curatedEntry.days_remaining != null && ` · ${curatedEntry.days_remaining} days left`}
                </p>
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
                {curatedEntry.source === 'ntdeals' ? 'View on NT Deals' : 'View Nintendo Life Selects'}
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
              </a>
            </div>
          ))}

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
            {steamUrl && (
              <a
                href={steamUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 bg-[#171a21] text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-[#0f1116] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M11.979 0C5.668 0 .504 4.936.034 11.134l5.856 2.426 1.76-1.76c-.052-.365-.022-.75.127-1.116.328-.802 1.259-1.191 2.061-.864l2.56-3.66c-.07-.31-.06-.636.052-.942.417-1.018 1.597-1.512 2.615-1.095 1.019.417 1.513 1.596 1.096 2.615-.417 1.018-1.597 1.512-2.615 1.095-.54-.22-.916-.683-1.07-1.188l-2.66 3.804c.28.272.5.61.622 1.002.327.802-.062 1.733-.864 2.06-.802.328-1.733-.062-2.06-.863-.12-.293-.142-.598-.086-.893l-4.757-1.97c1.558 4.28 5.626 7.33 10.59 7.33 6.627 0 12-5.373 12-12S18.606 0 11.979 0z"/></svg>
                Steam Reviews
              </a>
            )}
            {selectedVideo?.type === 'youtube' && (
              <a
                href={`https://www.youtube.com/watch?v=${selectedVideo.video_id}`}
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
    </dialog>
  );
}
