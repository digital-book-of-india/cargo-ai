"use client";

// Used only when the root layout itself fails. It must bring its own html and body, and it
// cannot rely on the app's styles, so it uses plain inline styles.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 24, color: "#0F172A" }}>
        <main style={{ maxWidth: 480, margin: "48px auto" }}>
          <h1 style={{ fontSize: 22 }}>DBI Intelligence could not load</h1>
          <p>Something went wrong. Please try again. If it keeps happening, check back in a few minutes.</p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#2563EB",
              color: "#fff",
              border: 0,
              borderRadius: 8,
              padding: "10px 16px",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
