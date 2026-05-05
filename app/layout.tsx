import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bundler - cross-promo matchmaking for indie devs",
  description:
    "Match with other indie devs whose games would pair well with yours - for Steam bundles, store-page link swaps, news-post shoutouts, or any other cross-promo. Built by indies, for indies.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
