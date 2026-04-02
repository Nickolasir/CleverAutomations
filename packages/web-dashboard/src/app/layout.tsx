import type { ReactNode } from "react";
import type { Metadata } from "next";
import { AuthProvider } from "./auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clever Automations Dashboard",
  description: "AI-powered smart home management dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-surface-secondary">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
