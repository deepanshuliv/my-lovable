import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Anton, Permanent_Marker, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const fontHeading = Anton({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-heading',
});

const fontHandwritten = Permanent_Marker({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-handwritten',
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
      <html lang="en" className={`${fontHeading.variable} ${fontHandwritten.variable} ${fontBody.variable}`}>
        <body className="font-sans antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
