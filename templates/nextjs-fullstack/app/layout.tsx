import type { Metadata } from 'next';
import ErrorReporter from './error-reporter';
import './globals.css';

export const metadata: Metadata = {
  title: 'Generated app',
  description: 'Built with my-lovable',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/*
          Only active when this page is framed — i.e. when it is being shown as a preview
          inside the builder. Opened directly in a tab it does nothing at all.
        */}
        <ErrorReporter />
        {children}
      </body>
    </html>
  );
}
