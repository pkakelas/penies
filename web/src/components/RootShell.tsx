import { Analytics } from "@vercel/analytics/next";
import { Commissioner, Noto_Serif_Display } from "next/font/google";
import type { Lang } from "@/lib/i18n";
import "@/app/globals.css";

// Both typefaces cover Greek: a high-contrast serif for titles, a calm sans for text.
const display = Noto_Serif_Display({
  subsets: ["greek", "latin"],
  style: ["normal", "italic"],
  variable: "--font-noto-display",
  display: "swap",
});
const body = Commissioner({
  subsets: ["greek", "latin"],
  variable: "--font-commissioner",
  display: "swap",
});

/** The <html> and <body> shared by the Greek and the English half of the site. */
export function RootShell({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return (
    <html lang={lang} className={`${display.variable} ${body.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
