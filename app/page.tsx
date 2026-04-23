import DealsClient from '@/components/DealsClient';

type HomePageProps = {
  searchParams?: {
    game?: string | string[];
  };
};

export default function HomePage({ searchParams }: HomePageProps) {
  const gameParam = searchParams?.game;
  const initialGameId = typeof gameParam === 'string'
    ? gameParam
    : Array.isArray(gameParam)
      ? gameParam[0]
      : undefined;

  return <DealsClient initialGameId={initialGameId} />;
}
