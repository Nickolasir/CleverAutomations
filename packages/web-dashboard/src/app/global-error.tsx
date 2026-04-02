"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ textAlign: "center", padding: "4rem 1rem" }}>
        <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>Something went wrong</h1>
        <p style={{ marginBottom: "2rem" }}>{error.message || "An unexpected error occurred."}</p>
        <button
          onClick={() => reset()}
          style={{
            padding: "0.5rem 1.5rem",
            background: "#D4A843",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            cursor: "pointer",
          }}
        >
          Try Again
        </button>
      </body>
    </html>
  );
}
