import type { Metadata } from "next";
import { Fraunces, Inter, Montserrat } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-fraunces",
});
const montserrat = Montserrat({ subsets: ["latin"], weight: ["700"], variable: "--font-montserrat" });

const description =
  "Staff Software Engineer with 6+ years building products at scale. Modern Animal (healthtech), Elsewhere (iOS). UCLA CS. TypeScript, React, Go, AWS.";

// Preview builds (e.g. a copy hosted elsewhere) set NEXT_PUBLIC_NOINDEX=1 so
// search engines don't index a duplicate of the real site.
const noindex = process.env.NEXT_PUBLIC_NOINDEX === "1";

export const metadata: Metadata = {
  title: "Christopher Ngai | Software Engineer",
  description,
  authors: [{ name: "Christopher Ngai", url: "https://github.com/cngai" }],
  creator: "Christopher Ngai",
  keywords: [
    "Christopher Ngai", "software engineer", "staff engineer", "full-stack developer", "React",
    "TypeScript", "Modern Animal", "healthtech", "iOS", "UCLA", "Los Angeles",
  ],
  robots: noindex ? { index: false, follow: false } : { index: true, follow: true },
  openGraph: {
    title: "Christopher Ngai | Software Engineer",
    description,
    url: "https://cngai.dev",
    siteName: "Christopher Ngai",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "https://www.christopherngai.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "Christopher Ngai – Staff Software Engineer. Modern Animal, Elsewhere, UCLA.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Christopher Ngai | Software Engineer",
    description:
      "Staff Software Engineer with 6+ years building products at scale. Modern Animal (healthtech), Elsewhere (iOS). UCLA CS.",
    images: ["https://www.christopherngai.com/og-image.png"],
  },
};

// Runs before paint so the saved / system theme applies without a flash.
const themeScript = `(function(){try{var d=localStorage.getItem("theme-dark");var dark=d!==null?d==="true":window.matchMedia("(prefers-color-scheme:dark)").matches;if(dark)document.documentElement.classList.add("dark")}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${montserrat.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
