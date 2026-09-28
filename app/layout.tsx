import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Karta — Turn every conversation into a sale",
  description: "AI commerce platform for WooCommerce merchants",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
