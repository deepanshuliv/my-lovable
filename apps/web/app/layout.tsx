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
  icons: {
    icon: '/logo.jpg',
  },
};

import { dark } from '@clerk/themes';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#ffffff',
          colorBackground: '#0a0a0b',
          colorInputBackground: '#121214',
          colorInputText: '#ffffff',
          colorText: '#ffffff',
          colorTextSecondary: '#a1a1aa',
          borderRadius: '0.75rem',
        },
        elements: {
          card: {
            backgroundColor: '#0a0a0b',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          },
          headerTitle: { color: '#ffffff' },
          headerSubtitle: { color: '#a1a1aa' },
          socialButtonsBlockButton: {
            backgroundColor: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#ffffff',
          },
          socialButtonsBlockButtonText: { color: '#ffffff', fontWeight: '500' },
          dividerLine: { background: 'rgba(255,255,255,0.1)' },
          dividerText: { color: '#a1a1aa' },
          formFieldLabel: { color: '#ffffff' },
          formFieldInput: {
            backgroundColor: 'rgba(255,255,255,0.03)',
            borderColor: 'rgba(255,255,255,0.1)',
            color: '#ffffff',
          },
          formButtonPrimary: {
            backgroundColor: '#ffffff',
            color: '#000000',
            textTransform: 'uppercase',
            fontWeight: '700',
            letterSpacing: '0.05em'
          },
          footerActionLink: { color: '#ffffff', fontWeight: '600' },
          footerActionText: { color: '#a1a1aa' },
          footer: {
            background: 'transparent',
            borderTop: '1px solid rgba(255,255,255,0.1)'
          },
          userButtonPopoverCard: {
            backgroundColor: '#0a0a0b',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          },
          userPreviewMainIdentifier: { color: '#ffffff', fontWeight: '600' },
          userPreviewSecondaryIdentifier: { color: '#a1a1aa' },
          userButtonPopoverActionButton: { color: '#ffffff' },
          userButtonPopoverActionButtonText: { color: '#ffffff' },
          userButtonPopoverActionButtonIconBox: { color: '#ffffff' },
          userButtonPopoverFooter: { background: 'transparent' }
        }
      }}
    >
      <html lang="en" className={`${fontHeading.variable} ${fontHandwritten.variable} ${fontBody.variable}`}>
        <body className="font-sans antialiased">{children}</body>
      </html>
    </ClerkProvider>
  );
}
