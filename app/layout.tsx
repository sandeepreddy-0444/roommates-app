import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { MaterialIconFont } from "@/components/MaterialIconFont";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Roommates",
  title: {
    default: "Roommates",
    template: "%s | Roommates",
  },
  description: "Split bills, track groceries, manage chores, and stay organized.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Roommates",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8fafc",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Theme is applied to <html> from localStorage before paint (see script below).
          That can differ from the server render; suppressHydrationWarning avoids a false
          positive hydration mismatch on this tag only.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k='roommates-app-theme';var t=localStorage.getItem(k);if(t==='light'||!t){document.documentElement.removeAttribute('data-app-theme');return;}var ok={dark:1,ocean:1,lavender:1,forest:1,sunset:1,rose:1,amber:1,slate:1,berry:1};if(ok[t])document.documentElement.setAttribute('data-app-theme',t);}catch(e){}})();`,
          }}
        />
        <MaterialIconFont />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased safe-area`}
      >
        {children}
      </body>
    </html>
  );
}