import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nintendo Deals',
  description: 'Personal Nintendo eShop deal tracker',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
