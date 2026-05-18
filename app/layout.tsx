import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://bundler.games"),
  title: "Bundler - cross-promo matchmaking for indie devs",
  description:
    "Match with other indie devs whose games would pair well with yours - for Steam bundles, Curator picks, news-post shoutouts, or any other cross-promo. Built by indies, for indies.",
  openGraph: {
    title: "Bundler: Tinder for indie devs",
    description:
      "A free, open-source matchmaker for Steam cross-promotion: bundles, news shoutouts, Curator picks. Live at bundler.games.",
    url: "https://bundler.games",
    siteName: "Bundler",
    images: [
      {
        url: "/bundler-og.png",
        width: 1200,
        height: 630,
        alt: "Bundler - a free, open-source matchmaker for Steam cross-promotion",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bundler: Tinder for indie devs",
    description:
      "A free, open-source matchmaker for Steam cross-promotion. Live at bundler.games.",
    images: ["/bundler-og.png"],
  },
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
