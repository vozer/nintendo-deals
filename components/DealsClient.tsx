'use client';

import { useCallback, useEffect, useState } from 'react';
import { NintendoGame, Preferences, SortOption, PreferenceAction } from '@/lib/types';
import GameCard from './GameCard';
import SearchBar from './SearchBar';
import SortSelect from './SortSelect';
import HiddenGamesPanel from './HiddenGamesPanel';

export default function DealsClient() {
  const [games, setGames] = useState<NintendoGame[]>([]);
  const [total, setTotal] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>({ hiddenGames: [], watchGames: {} });
  const [sort, setSort] = useState<SortOption>('popularity');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const fetchGames = useCallback(async (start = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = new URLSearchParams({ sort, rows: '48', start: String(start) });
      if (search) params.set('search', search);
      const res = await fetch(`/api/games?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      if (append) {
        setGames((prev) => [...prev, ...data.games]);
      } else {
        setGames(data.games);
      }
      setTotal(data.total);
      setError('');
    } catch {
      setError('Failed to load games from Nintendo. Try refreshing.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [sort, search]);

  const fetchPreferences = useCallback(async () => {
    try {
      const res = await fetch('/api/preferences');
      if (res.ok) {
        const data = await res.json();
        setPreferences(data);
      }
    } catch {
      // Preferences not critical - continue without them
    }
  }, []);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  async function updatePreference(action: PreferenceAction) {
    try {
      const res = await fetch('/api/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      if (res.ok) {
        const data = await res.json();
        setPreferences(data);
      }
    } catch {
      // Silent fail for preference updates
    }
  }

  function handleHide(gameId: string) {
    setPreferences((prev) => ({
      ...prev,
      hiddenGames: [...prev.hiddenGames, gameId],
    }));
    updatePreference({ action: 'hide', gameId });
  }

  function handleUnhide(gameId: string) {
    setPreferences((prev) => ({
      ...prev,
      hiddenGames: prev.hiddenGames.filter((id) => id !== gameId),
    }));
    updatePreference({ action: 'unhide', gameId });
  }

  function handleWatch(gameId: string, threshold: 5 | 10, title: string) {
    setPreferences((prev) => ({
      ...prev,
      watchGames: { ...prev.watchGames, [gameId]: { threshold, title } },
    }));
    updatePreference({ action: 'watch', gameId, threshold, title });
  }

  function handleUnwatch(gameId: string) {
    setPreferences((prev) => {
      const next = { ...prev, watchGames: { ...prev.watchGames } };
      delete next.watchGames[gameId];
      return next;
    });
    updatePreference({ action: 'unwatch', gameId });
  }

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    window.location.href = '/login';
  }

  const visibleGames = games.filter((game) => {
    if (preferences.hiddenGames.includes(game.fs_id)) return false;
    const watchEntry = preferences.watchGames[game.fs_id];
    if (watchEntry && game.price_discounted_f >= watchEntry.threshold) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-[#E60012] px-4 sm:px-8 h-14 sm:h-16 flex items-center justify-between shrink-0">
        <h1 className="text-white font-bold text-lg sm:text-xl tracking-tight">
          Nintendo Deals
        </h1>
        <div className="flex items-center gap-3">
          <span className="bg-white/15 text-white text-xs font-semibold px-3 py-1 rounded-full">
            {total.toLocaleString()} deals
          </span>
          <button
            onClick={handleLogout}
            className="text-white/70 hover:text-white transition-colors"
            title="Logout"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></svg>
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="bg-white px-4 sm:px-8 py-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center border-b border-gray-100">
        <SearchBar value={search} onChange={setSearch} />
        <SortSelect value={sort} onChange={setSort} />
      </div>

      {/* Content */}
      <main className="flex-1 px-4 sm:px-8 py-6">
        {loading ? (
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
            <button
              onClick={() => fetchGames()}
              className="mt-4 text-sm text-[#E60012] font-medium hover:underline"
            >
              Try again
            </button>
          </div>
        ) : visibleGames.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 text-sm">No games match your filters.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleGames.map((game) => (
                <GameCard
                  key={game.fs_id}
                  game={game}
                  preferences={preferences}
                  onHide={handleHide}
                  onWatch={handleWatch}
                  onUnwatch={handleUnwatch}
                />
              ))}
            </div>

            {games.length < total && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={() => fetchGames(games.length, true)}
                  disabled={loadingMore}
                  className="px-6 py-2.5 bg-white text-sm font-medium text-gray-700 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading...' : `Load more (${games.length} of ${total})`}
                </button>
              </div>
            )}
          </>
        )}

        {/* Hidden games panel */}
        <div className="mt-8">
          <HiddenGamesPanel
            hiddenIds={preferences.hiddenGames}
            allGames={games}
            onUnhide={handleUnhide}
          />
        </div>
      </main>
    </div>
  );
}
