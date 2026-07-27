import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tikfetch — Premium TikTok HD Video Downloader",
  description: "Download original TikTok HD videos by single link, batch list, or browse user profiles directly with zero server disk storage.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-[#fafafa] text-[#09090b] antialiased flex flex-col justify-between selection:bg-[#09090b] selection:text-[#fafafa]">
        {children}
      </body>
    </html>
  );
}
