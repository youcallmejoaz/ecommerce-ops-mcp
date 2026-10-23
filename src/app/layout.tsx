import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Store Ops Admin",
  description: "Approval queue and activity log for the e-commerce ops MCP server",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
