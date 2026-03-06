'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/');
        router.refresh();
      } else {
        setError('Wrong password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <form onSubmit={handleSubmit} className="w-full max-w-xs flex flex-col items-center gap-6">
        <div className="w-12 h-12 rounded-full bg-[#E60012] flex items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="6" x2="10" y1="11" y2="11" />
            <line x1="8" x2="8" y1="9" y2="13" />
            <line x1="15" x2="15.01" y1="12" y2="12" />
            <line x1="18" x2="18.01" y1="10" y2="10" />
            <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
          </svg>
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Nintendo Deals</h1>
          <p className="text-sm text-gray-500 mt-1">Your personal eShop deal tracker</p>
        </div>

        <div className="w-full flex flex-col gap-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password..."
            className="w-full h-12 px-4 bg-gray-100 rounded-xl text-sm text-gray-900 placeholder-gray-400 outline-none focus:ring-2 focus:ring-[#E60012]/30"
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full h-12 bg-[#E60012] text-white font-semibold rounded-xl hover:bg-[#cc0010] transition-colors disabled:opacity-50"
          >
            {loading ? 'Entering...' : 'Enter'}
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-500">{error}</p>
        )}
      </form>
    </div>
  );
}
