import DealsClient from '@/components/DealsClient';

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const gameParam = params.game;
  const initialGameId = typeof gameParam === 'string'
    ? gameParam
    : Array.isArray(gameParam)
      ? gameParam[0]
      : undefined;

  return <DealsClient initialGameId={initialGameId} />;
}
