import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Outfit, Plus_Jakarta_Sans, Space_Mono } from 'next/font/google';
import './globals.css';

const fontHeading = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-heading',
});

const fontMono = Space_Mono({
  weight: ['400', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

const fontBody = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'my-lovable',
  description: 'Describe an app, watch it get built.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
        <ClerkProvider>
      <html lang="en" className={`${fontHeading.variable} ${fontMono.variable} ${fontBody.variable}`}>
        <body className="font-sans antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
