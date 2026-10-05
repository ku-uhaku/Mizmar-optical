'use client';

/** Last-resort boundary (root layout failed, e.g. API down with a cold cache). Static, trilingual, no providers. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 480 }}>
          <h1 style={{ fontSize: '1.5rem' }}>Service temporairement indisponible</h1>
          <p>Nous revenons dans un instant. · We'll be right back. · سنعود بعد قليل.</p>
          <button onClick={reset} style={{ marginTop: 12, padding: '8px 20px', borderRadius: 6, border: '1px solid #ccc', cursor: 'pointer' }}>Réessayer · Retry · إعادة المحاولة</button>
        </div>
      </body>
    </html>
  );
}
