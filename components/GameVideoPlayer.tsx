'use client';

import { useEffect, useRef, useState } from 'react';
import { GameVideo } from '@/lib/types';
import { mediaUrl } from '@/lib/game-presentation';

export default function GameVideoPlayer({ video }: { video: GameVideo }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const hls = mediaUrl(video.hls_url) ? video.hls_url : undefined;
  const direct = mediaUrl(video.content_url) ? video.content_url : undefined;
  const youtubeId = video.type === 'youtube' && /^[\w-]{11}$/.test(video.video_id) ? video.video_id : undefined;
  const source = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : mediaUrl(video.source_url) ? video.source_url : undefined;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (direct) return;
    if (!hls) return;
    if (element.canPlayType('application/vnd.apple.mpegurl')) {
      element.src = hls;
      element.controls = true;
      return () => element.pause();
    }
    let disposed = false;
    let destroy: (() => void) | undefined;
    void import('hls.js').then(({ default: Hls }) => {
      if (disposed) return;
      if (!Hls.isSupported()) { setFailed(true); return; }
      const player = new Hls();
      destroy = () => player.destroy();
      player.on(Hls.Events.MEDIA_ATTACHED, () => { if (!disposed) setReady(true); });
      player.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) setFailed(true); });
      player.loadSource(hls);
      player.attachMedia(element);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; element.pause(); destroy?.(); };
  }, [hls, direct]);

  return <div className="flex h-full flex-col bg-gray-900">
    <div className="min-h-0 flex-1">
      {!failed && youtubeId ? <iframe src={`https://www.youtube-nocookie.com/embed/${youtubeId}?hl=en`} title={video.name || 'Game trailer'} className="h-full w-full" allow="encrypted-media; fullscreen" allowFullScreen />
        : !failed && (direct || hls) ? <video ref={ref} controls={ready || Boolean(direct)} playsInline preload="none" src={direct} poster={mediaUrl(video.thumbnail) ? video.thumbnail : undefined} className="h-full w-full" onLoadStart={() => setReady(true)} onError={() => setFailed(true)} aria-label={video.name || 'Game trailer'} />
          : <p className="p-5 text-sm text-white">This video cannot be played here.</p>}
    </div>
    {!ready && !failed && hls && !direct && <p role="status" className="px-4 text-sm text-white">Loading video player...</p>}
    {source && <a href={source} target="_blank" rel="noopener noreferrer" className="px-4 py-2 text-sm text-white underline">Watch on {youtubeId ? 'YouTube' : video.source === 'steam' ? 'Steam (PC footage)' : 'source'}</a>}
  </div>;
}
