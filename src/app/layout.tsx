import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SITE, siteOrigin } from "@/lib/config";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SkyBand } from "@/components/sky-band";
import "./globals.css";

const display = localFont({
  src: "./fonts/Fraunces-latin-wght-normal.woff2",
  variable: "--font-display-family",
  display: "swap",
  weight: "300 800",
});

const mono = localFont({
  src: "./fonts/FragmentMono-latin-400-normal.woff2",
  variable: "--font-mono-family",
  display: "swap",
  weight: "400",
});

const origin = siteOrigin();

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [
    "houseplant survival prediction",
    "plant gifting",
    "houseplant care",
    "Open-Meteo",
    "logistic regression",
    "MCP tools",
    "explainable model",
  ],
  authors: [{ name: SITE.author, url: `https://github.com/${SITE.author}` }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: origin,
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#e7ebe3",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-[3px] focus:bg-plaster focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="-mx-4 mb-8 sm:-mx-6">
            <SkyBand
              latitude={SITE.defaultCity.latitude}
              longitude={SITE.defaultCity.longitude}
              placeLabel={SITE.defaultCity.label}
            />
          </div>
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}