import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_STORAGE_KEY } from "@/store/persistVersion";
import "./globals.css";

// Papel quente type: Bricolage Grotesque for headings, Inter for body text, IBM Plex Mono for
// numbers. Bricolage and Inter are variable fonts (no weight list); IBM Plex Mono is static, so
// its weights are listed. `--font-sans/-heading/-display/-mono` in globals.css point at these.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Monospace is scoped to data/numbers only (with tabular + slashed-zero figures).
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SystemForge — System Design Interview Simulator",
  description:
    "SystemForge is an interactive system design interview simulator — build architectures on a canvas, simulate production traffic, and get scored like a real interview.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#EEE8DF", // --sf-bg in light, the default theme
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      // The inline theme script below adds the `dark` class before React
      // hydrates when the persisted theme is dark, so the html class may differ
      // from SSR — suppress the expected hydration warning (canonical theme-toggle pattern).
      suppressHydrationWarning
      className={`${bricolage.variable} ${inter.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-background text-foreground">
        {/* Apply the persisted theme before first paint to avoid a flash: light is the default,
            so `dark` is added only when the stored theme is dark. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem(${JSON.stringify(APP_STORAGE_KEY)});var t=s&&JSON.parse(s).state&&JSON.parse(s).state.theme;document.documentElement.classList.toggle('dark',t==='dark');}catch(e){}})();`,
          }}
        />
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
