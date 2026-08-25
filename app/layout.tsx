import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { VemetricScript } from "@vemetric/react";
import { config } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  // No `icons` here on purpose. Declaring one pins the tag to a bare "/icon.svg", and a
  // browser that has already cached a favicon under that exact URL keeps showing the old
  // artwork forever. Left alone, the app/icon.svg file convention emits the same file
  // with a content hash on the URL, so changing the logo changes the URL and the tab
  // updates. Whenever the logo changes, change components/Logo.tsx and app/icon.svg
  // together -- they are the same mark drawn twice.
  title: {
    default: "yourhour — feature your product, pay only for valid visits",
    template: "%s · yourhour",
  },
  description:
    "Feature your product on the yourhour homepage and pay only for valid visits. 20¢ per visit, counted transparently, with any unused balance refunded after seven days.",
  openGraph: {
    type: "website",
    siteName: "yourhour",
    url: config.siteUrl,
    title: "yourhour — feature your product, pay only for valid visits",
    description:
      "Feature your product. Pay only for valid visits — 20¢ each, unused balance refunded.",
    images: [
      {
        url: "/og.png",
        width: 1729,
        height: 910,
        alt: "yourhour.lol — feature your product, pay only for valid visits",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og.png"],
  },
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
        {config.xPixel.id ? (
          <Script id="x-pixel" strategy="afterInteractive">
            {`!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
            },s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
            a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
            twq('config','${config.xPixel.id}');`}
          </Script>
        ) : null}
        {children}
      </body>
    </html>
  );
}
