import type { Metadata } from 'next';
import ErrorReporter from './error-reporter';
import './globals.css';

export const metadata: Metadata = {
  title: 'Generated app',
  description: 'Built with Inkling',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
