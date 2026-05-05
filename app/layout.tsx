import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bundler - find indie bundle partners",
  description:
    "Match with other indie devs whose games would pair well with yours in a Steam bundle. Built by indies, for indies.",
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
