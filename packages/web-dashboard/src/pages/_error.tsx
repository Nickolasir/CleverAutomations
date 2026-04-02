import type { NextPageContext } from "next";

function ErrorPage({ statusCode }: { statusCode: number }) {
  return (
    <div style={{ textAlign: "center", padding: "4rem 1rem", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>
        {statusCode === 404 ? "404 - Page Not Found" : `${statusCode} - An error occurred`}
      </h1>
      <p style={{ marginBottom: "2rem", color: "#666" }}>
        {statusCode === 404
          ? "The page you are looking for does not exist."
          : "Something went wrong. Please try again."}
      </p>
      <a href="/dashboard" style={{ color: "#D4A843", textDecoration: "underline" }}>
        Return to Dashboard
      </a>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode: statusCode ?? 500 };
};

export default ErrorPage;
