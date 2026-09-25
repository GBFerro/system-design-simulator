import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// One grotesque does both body and display (differentiated by weight + tracking)
// — escapes the "Geist = AI default" read while staying refined and legible.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

// Monospace is scoped to data/numbers only (with tabular + slashed-zero figures).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  themeColor: "#09090b",
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
      // The inline theme script below toggles the `dark` class before React
      // hydrates, so the html class intentionally differs from SSR — suppress
      // the expected hydration warning (canonical theme-toggle pattern).
      suppressHydrationWarning
      className={`${hanken.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-background text-foreground">
        {/* Apply persisted theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('systemsim-app');var t=s&&JSON.parse(s).state&&JSON.parse(s).state.theme;document.documentElement.classList.toggle('dark',t!=='light');}catch(e){}})();`,
          }}
        />
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
