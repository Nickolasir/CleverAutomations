import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>404 - Page Not Found</h1>
      <p style={{ marginBottom: "2rem" }}>The page you are looking for does not exist.</p>
      <Link href="/dashboard" style={{ color: "#D4A843", textDecoration: "underline" }}>
        Return to Dashboard
      </Link>
    </div>
  );
}
