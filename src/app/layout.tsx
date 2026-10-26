import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { getI18n } from "@/lib/i18n/server";
import "./globals.css";

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "عزمي صوالحي وأولاده", template: "%s · عزمي صوالحي وأولاده" },
  description: "Private inventory and invoice workspace",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3b2416",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { locale, dir } = await getI18n();
  return (
    <html lang={locale} dir={dir} className={`${plexArabic.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
