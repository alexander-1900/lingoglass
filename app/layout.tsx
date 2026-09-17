import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
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
    <html lang="en">
      <body>
        <div className="ambient-orbs" aria-hidden="true">
          <div className="orb orb-1" />
          <div className="orb orb-2" />
          <div className="orb orb-3" />
        </div>
        {children}
      </body>
    </html>
  );
}
