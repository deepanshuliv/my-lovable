'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'ui-sans-serif, system-ui, sans-serif', background: '#fafafa', color: '#1c1d1a' }}>
        <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 36, letterSpacing: '-0.03em', margin: 0 }}>Something went wrong.</h1>
          <p style={{ marginTop: 16, maxWidth: 420, fontSize: 17, lineHeight: 1.5, color: '#5d5e58' }}>
            Inkling could not load. Your work is saved. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 32, minHeight: 46, padding: '0 20px', borderRadius: 10, border: '2px solid #1c1d1a', background: '#c6fd50', color: '#1c1d1a', fontWeight: 700, textTransform: 'uppercase', cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
