import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { validateEnv } from "@/lib/env";

validateEnv();

// Schibsted Grotesk carries the display sizes: tight apertures and slightly
// squared terminals give the headline a point of view, where the category's
// default UI sans has none. JetBrains Mono is here for code and identifiers
// only, never as decoration.
const sans = Schibsted_Grotesk({
  variable: "--font-sans-face",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  display: "swap",
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#ffffff',
}

export const metadata: Metadata = {
  metadataBase: new URL('https://tages.ai'),
  title: {
    default: "Tages — Shared memory for AI coding agents",
    template: "%s — Tages",
  },
  description:
    "Your team's agents forget between sessions. Tages gives them shared, persistent memory about your codebase — installed with one command, with semantic search that needs nothing running locally.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {/*
          THESIS: Shared agent memory is a correctness problem, not a storage
          feature; the surface argues it by showing the real commands and the
          real failure modes. It refuses the SaaS landing arrangement of a
          gradient hero over three icon cards over a logo wall.

          OWN-WORLD: White ground (#ffffff) with a four-step paper scale and a
          four-step ink ramp; one blue signal (#2563eb) used only on actions,
          links and code accents; structure carried by fading hairlines and
          generous whitespace rather than by boxes; Schibsted Grotesk against
          JetBrains Mono, with mono reserved for commands, keys and identifiers.

          STORY: An engineer told to adopt this understands what it is, sees
          the exact install and join commands, learns why a shared index can
          silently rot, and leaves having run one line.

          FIRST VIEWPORT: Left-aligned single column on a flat white ground —
          no gradient, no image, no metric row, no eyebrow. Statement headline,
          one clarifying paragraph at 68ch, then the real install command in a
          copyable mono field with the primary action beside it. The recall
          transcript follows immediately, so proof arrives before instructions.

          FORM: Category canon (developer-infrastructure), pinned by the brief
          against Supabase and Stripe/Resend as the craft bar; no concept roll
          was run because a brief-pinned direction beats the roll.

          FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
        */}
        {children}
      </body>
    </html>
  );
}
