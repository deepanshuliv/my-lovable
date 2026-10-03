import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Geist_Mono, Sedgwick_Ave } from 'next/font/google';
import localFont from 'next/font/local';
import { THEME_BOOT } from '@/lib/theme';
import './globals.css';

const satoshi = localFont({
  src: [
    { path: './fonts/Satoshi-500.woff2', weight: '500' },
    { path: './fonts/Satoshi-700.woff2', weight: '700' },
    { path: './fonts/Satoshi-900.woff2', weight: '900' },
  ],
  display: 'swap',
  variable: '--font-satoshi',
});

const scrawl = Sedgwick_Ave({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-scrawl',
});

const fontCode = Geist_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-code',
});

const TITLE = 'Inkling: from an idea to a working app';
const DESCRIPTION =
  'Describe your idea in plain words. Inkling writes real code, runs it, and develops a working app in front of you.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001'),
  title: { default: TITLE, template: '%s | Inkling' },
  description: DESCRIPTION,
  applicationName: 'Inkling',
  openGraph: {
    type: 'website',
    siteName: 'Inkling',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/sites/yoga.jpg', alt: 'A yoga booking website built with Inkling' }],
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/sites/yoga.jpg'] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#111210' },
  ],
};

const clerkAppearance = {
  variables: {
    colorPrimary: '#c6fd50',
    colorPrimaryForeground: '#1c1d1a',
    colorBackground: '#ffffff',
    colorForeground: '#1c1d1a',
    colorMuted: '#f3f2ea',
    colorMutedForeground: '#5d5e58',
    colorNeutral: '#1c1d1a',
    colorInput: '#ffffff',
    colorInputForeground: '#1c1d1a',
    colorBorder: '#1c1d1a',
    colorRing: 'rgba(198,253,80,0.6)',
    colorDanger: '#d93b2b',
    colorSuccess: '#2f9e44',
    colorWarning: '#b57900',
    colorShadow: 'rgba(28,29,26,0.16)',
    colorModalBackdrop: 'rgba(28,29,26,0.55)',
    fontFamily: 'var(--font-satoshi), ui-sans-serif, system-ui, sans-serif',
    fontFamilyButtons: 'var(--font-satoshi), ui-sans-serif, system-ui, sans-serif',
    borderRadius: '10px',
  },
  elements: {
    cardBox: {
      border: '2px solid #1c1d1a',
      boxShadow: '6px 6px 0 #1c1d1a',
      borderRadius: '18px',
    },
    headerTitle: { fontWeight: 700, letterSpacing: '-0.02em' },
    formButtonPrimary: {
      border: '2px solid #1c1d1a',
      boxShadow: '3px 3px 0 #1c1d1a',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.02em',
    },
    socialButtonsBlockButton: { border: '2px solid #1c1d1a' },
    formFieldInput: { borderWidth: '2px' },
    footerActionLink: { color: '#1c1d1a', fontWeight: 700, textDecoration: 'underline' },
    modalBackdrop: { backdropFilter: 'blur(4px)' },
    userButtonPopoverCard: {
      border: '2px solid #1c1d1a',
      boxShadow: '5px 5px 0 #1c1d1a',
      borderRadius: '14px',
    },
    avatarBox: { borderRadius: '8px', border: '2px solid #1c1d1a' },
    userButtonTrigger: { borderRadius: '10px' },
    userButtonAvatarBox: { width: '40px', height: '40px', borderRadius: '10px' },
  },
};

function ClerkNotConfigured({ fonts }: { fonts: string }) {
  return (
    <html lang="en" className={fonts}>
      <body className="font-sans">
        <main className="flex min-h-[100dvh] items-center justify-center p-6 text-center">
          <div className="max-w-md space-y-3">
            <h1 className="text-2xl font-bold tracking-tight">Sign-in is not set up yet</h1>
            <p className="text-sm text-[var(--muted)]">
              Add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to .env, then restart the web app.
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const fonts = `${satoshi.variable} ${scrawl.variable} ${fontCode.variable}`;
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return <ClerkNotConfigured fonts={fonts} />;

  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en" className={fonts} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        </head>
        <body className="font-sans">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
