import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { VemetricScript } from "@vemetric/react";
import { config } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
  title: {
    default: "yourhour — one product owns this page for one hour",
    template: "%s · yourhour",
  },
  description:
    "Twenty-four slots a day. One product owns the entire homepage for exactly one hour. When your hour starts, the whole page is yours.",
  openGraph: {
    type: "website",
    siteName: "yourhour",
    url: config.siteUrl,
    title: "yourhour — one product owns this page for one hour",
    description:
      "Twenty-four slots a day. One product owns the entire homepage for exactly one hour.",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  const vemetricToken = process.env.NEXT_PUBLIC_VEMETRIC_TOKEN;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {vemetricToken ? <VemetricScript token={vemetricToken} /> : null}
        {children}
      </body>
    </html>
  );
}
