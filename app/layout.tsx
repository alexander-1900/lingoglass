import type { Metadata, Viewport } from "next";
import {
  Caveat,
  EB_Garamond,
  Lora,
  Lobster_Two,
  Merriweather,
  Nunito,
  Playfair_Display,
} from "next/font/google";
import { SITE_BASE } from "@/lib/site";
import "./globals.css";

/* "Lobster Two" display face for titles and — until the reader picks another
   face — story lines (see globals.css). next/font self-hosts the woff2 files
   in the static export — no third-party request at runtime — and exposes the
   family through a CSS variable so the global stylesheet can apply it without
   touching every component. `italic` is loaded because the translation/subtitle
   lines are italic and would otherwise get a synthetic oblique. */
const lobsterTwo = Lobster_Two({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-lobster-two",
  display: "swap",
});

/* The other six reading faces (FONTS in lib/settings.ts) — selectable per
   reader, applied via <html data-font> → --font-reading in globals.css.
   preload:false keeps them out of the critical path: no <link rel=preload>
   is emitted, so the browser fetches a woff2 only when its family is actually
   used (font-display: swap paints the fallback in the meantime). Weight is
   omitted so each variable font's full wght axis is requested; Caveat has no
   italic face, so .translation-line's italic is synthesized there by the
   browser (the only style caveat of the seven). */
const playfairDisplay = Playfair_Display({
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-playfair-display",
  display: "swap",
  preload: false,
});
const lora = Lora({
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
  preload: false,
});
const merriweather = Merriweather({
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-merriweather",
  display: "swap",
  preload: false,
});
const ebGaramond = EB_Garamond({
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-eb-garamond",
  display: "swap",
  preload: false,
});
const nunito = Nunito({
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
  preload: false,
});
const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_BASE),
  title: {
    default: "lingoglass — a reading room of world stories",
    template: "%s · lingoglass",
  },
  description:
    "Learn languages through immersion: graded stories from A1 to C2 (and N5–N1 for Japanese) with English translation, tap-to-define words and native computer voice audio.",
};

export const viewport: Viewport = {
  themeColor: "#FAF6EE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${lobsterTwo.variable} ${playfairDisplay.variable} ${lora.variable} ${merriweather.variable} ${ebGaramond.variable} ${nunito.variable} ${caveat.variable}`}
    >
      <body>
        {/* Pre-paint reading-font restore: runs while the parser is still in
            <body>, before any story text paints, so a stored face never
            flashes the default. Validates against FONTS in lib/settings.ts —
            tests/font-settings.test.ts keeps this id list in sync. CSP allows
            inline scripts (public/_headers: script-src 'unsafe-inline'). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var f=localStorage.getItem("lingoglass:font");if(f&&/^(lobster-two|playfair|lora|merriweather|garamond|nunito|caveat)$/.test(f))document.documentElement.setAttribute("data-font",f)}catch(e){}',
          }}
        />
        <div className="ambient-orbs" aria-hidden="true">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
        </div>
        <canvas id="particle-canvas" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
