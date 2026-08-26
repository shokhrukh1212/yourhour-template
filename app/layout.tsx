import type { Metadata } from "next";
import Script from "next/script";
import localFont from "next/font/local";
import { VemetricScript } from "@vemetric/react";
import { config } from "@/lib/config";
import "./globals.css";

const publicSiteUrl = new URL("https://yourhour.lol");
const socialTitle = "YourHour — One Product Owns the Homepage";
const socialDescription =
  "Pay $1 more to take #1. Every buyer stays permanently on the leaderboard, ranked by total paid.";
const socialImage = {
  url: "/og2.png",
  width: 1200,
  height: 631,
  type: "image/png",
  alt: "YourHour — One Product Owns the Homepage",
};

// Next ships these exact variable fonts with the installed package. Loading them
// locally keeps production builds deterministic and avoids a Google Fonts request.
const geistSans = localFont({
  src: "../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "../node_modules/next/dist/next-devtools/server/font/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  metadataBase: publicSiteUrl,
  // No `icons` here on purpose. Declaring one pins the tag to a bare "/icon.svg", and a
  // browser that has already cached a favicon under that exact URL keeps showing the old
  // artwork forever. Left alone, the app/icon.svg file convention emits the same file
  // with a content hash on the URL, so changing the logo changes the URL and the tab
  // updates. Whenever the logo changes, change components/Logo.tsx and app/icon.svg
  // together -- they are the same mark drawn twice.
  title: {
    default: socialTitle,
    template: "%s · YourHour",
  },
  description: socialDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "YourHour",
    locale: "en_US",
    url: "/",
    title: socialTitle,
    description: socialDescription,
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title: socialTitle,
    description: socialDescription,
    images: [socialImage],
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
