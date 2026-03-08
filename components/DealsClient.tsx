'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NintendoGame, Preferences, SortOption, RatingsMap, MediaMap } from '@/lib/types';
import { classifyGame } from '@/lib/filters';
import { bayesianScore, computeGlobalMean, CONFIDENT_THRESHOLD } from '@/lib/sort-utils';
import GameCard from './GameCard';
import GameDetailModal from './GameDetailModal';
import SearchBar from './SearchBar';
import SortSelect from './SortSelect';

type ViewTab = 'deals' | 'collections' | 'sports' | 'thinking' | 'hidden' | 'watched';

const DEFAULT_PREFS: Preferences = { hiddenGames: [], watchGames: {}, thinkingAbout: [] };

export default function DealsClient() {
  const [allGames, setAllGames] = useState<NintendoGame[]>([]);
  const [allTotal, setAllTotal] = useState(0);
  const [collectionGames, setCollectionGames] = useState<NintendoGame[]>([]);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [sportsGames, setSportsGames] = useState<NintendoGame[]>([]);
  const [sportsTotal, setSportsTotal] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFS);
  const [ratings, setRatings] = useState<RatingsMap>({});
  const [media, setMedia] = useState<MediaMap>({});
  const [detailGame, setDetailGame] = useState<NintendoGame | null>(null);
  const [sort, setSort] = useState<SortOption>('value');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<ViewTab>('deals');
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);
  const [sportsLoaded, setSportsLoaded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(48);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const isClientSort = sort === 'rating' || sort === 'value';

  const fetchMainGames = useCallback(async (start = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    try {
      const serverSort = isClientSort ? 'popularity' : sort;
      const rows = isClientSort && !append ? '3000' : '48';
      const params = new URLSearchParams({ sort: serverSort, rows, start: String(start) });
      if (search) params.set('search', search);
      const res = await fetch(`/api/games?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      if (append) {
        setAllGames((prev) => [...prev, ...data.games]);
      } else {
        setAllGames(data.games);
      }
      setAllTotal(data.total);
      setError('');
    } catch {
      setError('Failed to load games from Nintendo. Try refreshing.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sort, search, isClientSort]);

  const fetchCollections = useCallback(async (start = 0, append = false) => {
    try {
      const serverSort = sort === 'rating' || sort === 'value' ? 'popularity' : sort;
      const params = new URLSearchParams({ sort: serverSort, rows: '48', start: String(start), tab: 'collections' });
      if (search) params.set('search', search);
      const res = await fetch(`/api/games?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (append) {
        setCollectionGames((prev) => [...prev, ...data.games]);
      } else {
        setCollectionGames(data.games);
      }
      setCollectionTotal(data.total);
      setCollectionsLoaded(true);
    } catch {
      // silent
    }
  }, [sort, search]);

  const fetchSports = useCallback(async (start = 0, append = false) => {
    try {
      const serverSort = sort === 'rating' || sort === 'value' ? 'popularity' : sort;
      const params = new URLSearchParams({ sort: serverSort, rows: '48', start: String(start), tab: 'sports' });
      if (search) params.set('search', search);
      const res = await fetch(`/api/games?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      if (append) {
        setSportsGames((prev) => [...prev, ...data.games]);
      } else {
        setSportsGames(data.games);
      }
      setSportsTotal(data.total);
      setSportsLoaded(true);
    } catch {
      // silent
    }
  }, [sort, search]);

  const fetchPreferences = useCallback(async () => {
    try {
      const res = await fetch('/api/preferences');
      if (res.ok) {
        const data = await res.json();
        setPreferences({ ...DEFAULT_PREFS, ...data });
      }
    } catch {
      // continue without preferences
    }
  }, []);

  const fetchRatings = useCallback(async () => {
    try {
      const res = await fetch('/api/ratings');
      if (res.ok) {
        const data = await res.json();
        setRatings(data);
      }
    } catch {
      // continue without ratings
    }
  }, []);

  const fetchMedia = useCallback(async () => {
    try {
      const res = await fetch('/api/media');
      if (res.ok) {
        const data = await res.json();
        setMedia(data);
      }
    } catch {
      // continue without media
    }
  }, []);

  useEffect(() => { fetchMainGames(); }, [fetchMainGames]);
  useEffect(() => { fetchPreferences(); }, [fetchPreferences]);
  useEffect(() => { fetchRatings(); }, [fetchRatings]);
  useEffect(() => { fetchMedia(); }, [fetchMedia]);

  useEffect(() => {
    if (activeTab === 'collections' && !collectionsLoaded) fetchCollections();
    if (activeTab === 'sports' && !sportsLoaded) fetchSports();
  }, [activeTab, collectionsLoaded, sportsLoaded, fetchCollections, fetchSports]);

  useEffect(() => {
    if (collectionsLoaded) fetchCollections();
    if (sportsLoaded) fetchSports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, search]);

  useEffect(() => { setVisibleCount(48); }, [sort, activeTab, search]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting || loadingMore || loading) return;

        if (isClientSort && activeTab === 'deals') {
          setVisibleCount((prev) => prev + 48);
          return;
        }

        const canFetchMore =
          (activeTab === 'deals' && allGames.length < allTotal) ||
          (activeTab === 'collections' && collectionGames.length < collectionTotal) ||
          (activeTab === 'sports' && sportsGames.length < sportsTotal);
        if (!canFetchMore) return;

        if (activeTab === 'collections') fetchCollections(collectionGames.length, true);
        else if (activeTab === 'sports') fetchSports(sportsGames.length, true);
        else fetchMainGames(allGames.length, true);
      },
      { rootMargin: '400px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    activeTab, loadingMore, loading, isClientSort,
    allGames.length, allTotal,
    collectionGames.length, collectionTotal,
    sportsGames.length, sportsTotal,
    fetchMainGames, fetchCollections, fetchSports,
  ]);

  function persistPrefs(prefs: Preferences) {
    fetch('/api/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }).catch(() => {});
  }

  function updatePrefs(updater: (prev: Preferences) => Preferences) {
    setPreferences((prev) => {
      const next = updater(prev);
      persistPrefs(next);
      return next;
    });
  }

  function handleHide(gameId: string) {
    updatePrefs((prev) => ({
      ...prev,
      hiddenGames: prev.hiddenGames.includes(gameId) ? prev.hiddenGames : [...prev.hiddenGames, gameId],
    }));
  }

  function handleUnhide(gameId: string) {
    updatePrefs((prev) => ({
      ...prev,
      hiddenGames: prev.hiddenGames.filter((id) => id !== gameId),
    }));
  }

  function handleWatch(gameId: string, threshold: 2 | 5 | 10, title: string) {
    updatePrefs((prev) => ({
      ...prev,
      watchGames: { ...prev.watchGames, [gameId]: { threshold, title } },
    }));
  }

  function handleUnwatch(gameId: string) {
    updatePrefs((prev) => {
      const next = { ...prev, watchGames: { ...prev.watchGames } };
      delete next.watchGames[gameId];
      return next;
    });
  }

  function handleThink(gameId: string) {
    updatePrefs((prev) => ({
      ...prev,
      thinkingAbout: prev.thinkingAbout.includes(gameId)
        ? prev.thinkingAbout.filter((id) => id !== gameId)
        : [...prev.thinkingAbout, gameId],
    }));
  }

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    window.location.href = '/login';
  }

  const dealsGames = useMemo(() => {
    return allGames.filter((game) => {
      const cls = classifyGame(game);
      if (cls !== 'deals') return false;
      if (preferences.hiddenGames.includes(game.fs_id)) return false;
      if (preferences.thinkingAbout?.includes(game.fs_id)) return false;
      const w = preferences.watchGames[game.fs_id];
      if (w && game.price_discounted_f >= w.threshold) return false;
      return true;
    });
  }, [allGames, preferences]);

  const hiddenCount = preferences.hiddenGames.length;
  const watchedCount = Object.keys(preferences.watchGames).length;
  const thinkingCount = preferences.thinkingAbout?.length || 0;

  const tabGames = useMemo((): NintendoGame[] => {
    switch (activeTab) {
      case 'deals':
        return dealsGames;
      case 'collections':
        return collectionGames.filter((g) => {
          if (preferences.hiddenGames.includes(g.fs_id)) return false;
          const w = preferences.watchGames[g.fs_id];
          if (w && g.price_discounted_f >= w.threshold) return false;
          return true;
        });
      case 'sports':
        return sportsGames.filter((g) => {
          if (preferences.hiddenGames.includes(g.fs_id)) return false;
          const w = preferences.watchGames[g.fs_id];
          if (w && g.price_discounted_f >= w.threshold) return false;
          return true;
        });
      case 'thinking':
        return allGames.filter((g) => preferences.thinkingAbout?.includes(g.fs_id));
      case 'hidden':
        return allGames.filter((g) => preferences.hiddenGames.includes(g.fs_id));
      case 'watched':
        return allGames.filter((g) => g.fs_id in preferences.watchGames);
      default:
        return [];
    }
  }, [activeTab, dealsGames, collectionGames, sportsGames, allGames, preferences]);

  const globalMean = useMemo(() => computeGlobalMean(ratings), [ratings]);

  const sortedGames = useMemo((): NintendoGame[] => {
    if (!isClientSort) return tabGames;

    const maxPrice = 15;
    const scored = tabGames.map((game) => {
      const r = ratings[game.fs_id];
      const rc = r?.rating_count ?? 0;
      const bs = bayesianScore(r?.total_rating, rc, globalMean);
      const confident = rc >= CONFIDENT_THRESHOLD && bs >= 0;
      const priceScore = (1 - game.price_discounted_f / maxPrice) * 100;
      const val = bs >= 0 ? bs * 0.7 + priceScore * 0.3 : -1;
      return { game, bs, rc, confident, val };
    });

    // Tier 1: confident games (10+ reviews), sorted by metric
    // Tier 2: games with some rating but few reviews, sorted by metric
    // Tier 3: unrated games, sorted by price
    const tier1 = scored.filter((s) => s.confident);
    const tier2 = scored.filter((s) => !s.confident && s.bs >= 0);
    const tier3 = scored.filter((s) => s.bs < 0);

    const sortFn = sort === 'rating'
      ? (a: typeof scored[0], b: typeof scored[0]) => b.bs - a.bs
      : (a: typeof scored[0], b: typeof scored[0]) => b.val - a.val;

    tier1.sort(sortFn);
    tier2.sort(sortFn);
    tier3.sort((a, b) => a.game.price_discounted_f - b.game.price_discounted_f);

    return [...tier1, ...tier2, ...tier3].map((s) => s.game);
  }, [tabGames, sort, ratings, globalMean, isClientSort]);

  const displayGames = isClientSort && activeTab === 'deals'
    ? sortedGames.slice(0, visibleCount)
    : sortedGames;

  const canLoadMore =
    (activeTab === 'deals' || activeTab === 'collections' || activeTab === 'sports') &&
    (() => {
      if (isClientSort && activeTab === 'deals') return visibleCount < sortedGames.length;
      if (activeTab === 'collections') return collectionGames.length < collectionTotal;
      if (activeTab === 'sports') return sportsGames.length < sportsTotal;
      return allGames.length < allTotal;
    })();

  const TABS: { id: ViewTab; label: string; count?: number }[] = [
    { id: 'deals', label: 'Deals', count: dealsGames.length },
    { id: 'collections', label: 'Collections' },
    { id: 'sports', label: 'Sports' },
    { id: 'thinking', label: 'Thinking', count: thinkingCount },
    { id: 'hidden', label: 'Hidden', count: hiddenCount },
    { id: 'watched', label: 'Watched', count: watchedCount },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-[#E60012] px-4 sm:px-8 h-14 sm:h-16 flex items-center justify-between shrink-0">
        <h1 className="text-white font-bold text-lg sm:text-xl tracking-tight">Nintendo Deals</h1>
        <div className="flex items-center gap-3">
          <span className="bg-white/15 text-white text-xs font-semibold px-3 py-1 rounded-full">
            {dealsGames.length.toLocaleString()} deals
          </span>
          <button onClick={handleLogout} className="text-white/70 hover:text-white transition-colors" title="Logout">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
          </button>
        </div>
      </header>

      <div className="bg-white px-4 sm:px-8 py-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center border-b border-gray-100">
        <SearchBar value={search} onChange={setSearch} />
        <SortSelect value={sort} onChange={setSort} />
      </div>

      <div className="bg-white px-4 sm:px-8 border-b border-gray-100 overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap ${
                activeTab === tab.id
                  ? 'text-[#E60012]'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.id ? 'bg-red-100 text-[#E60012]' : 'bg-gray-100 text-gray-500'
                }`}>
                  {tab.count}
                </span>
              )}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#E60012]" />
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 px-4 sm:px-8 py-6">
        {loading && activeTab === 'deals' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl overflow-hidden animate-pulse">
                <div className="w-full aspect-video bg-gray-200" />
                <div className="p-4 space-y-3">
                  <div className="h-5 bg-gray-200 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                  <div className="h-4 bg-gray-100 rounded w-full" />
                  <div className="h-6 bg-gray-200 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-red-500 text-sm">{error}</p>
            <button onClick={() => fetchMainGames()} className="mt-4 text-sm text-[#E60012] font-medium hover:underline">
              Try again
            </button>
          </div>
        ) : displayGames.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-sm">
              {activeTab === 'hidden' ? 'No hidden games yet.' :
               activeTab === 'watched' ? 'No watched games yet.' :
               activeTab === 'thinking' ? 'No games saved to think about yet.' :
               activeTab === 'collections' ? 'No collections on sale right now.' :
               activeTab === 'sports' ? 'No sports games on sale right now.' :
               'No games match your filters.'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {displayGames.map((game) => (
                <GameCard
                  key={game.fs_id}
                  game={game}
                  preferences={preferences}
                  rating={ratings[game.fs_id]}
                  media={media[game.fs_id]}
                  globalMean={globalMean}
                  onHide={activeTab === 'hidden' ? handleUnhide : handleHide}
                  onWatch={handleWatch}
                  onUnwatch={handleUnwatch}
                  hideLabel={activeTab === 'hidden' ? 'Unhide' : 'Hide'}
                  onOpenDetail={setDetailGame}
                  onThink={handleThink}
                />
              ))}
            </div>

            {canLoadMore && (
              <div ref={sentinelRef} className="flex justify-center mt-8 py-4">
                {loadingMore && (
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <div className="w-4 h-4 border-2 border-gray-300 border-t-[#E60012] rounded-full animate-spin" />
                    Loading more...
                  </div>
                )}
              </div>
            )}

            {activeTab === 'watched' && displayGames.length > 0 && (
              <div className="mt-6 p-4 bg-amber-50 rounded-xl">
                <p className="text-sm text-amber-700">
                  Games below are on your watch list. They&apos;re hidden from the Deals tab until their price drops below your threshold. Click the active threshold button to remove the watch.
                </p>
              </div>
            )}

            {activeTab === 'thinking' && displayGames.length > 0 && (
              <div className="mt-6 p-4 bg-blue-50 rounded-xl">
                <p className="text-sm text-blue-700">
                  Games you&apos;re considering. They&apos;re hidden from the Deals tab while bookmarked. Click the bookmark again to remove.
                </p>
              </div>
            )}
          </>
        )}
      </main>

      {detailGame && (
        <GameDetailModal
          game={detailGame}
          rating={ratings[detailGame.fs_id]}
          media={media[detailGame.fs_id]}
          onClose={() => setDetailGame(null)}
        />
      )}
    </div>
  );
}
