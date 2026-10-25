import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import ThemeProvider from "@/components/ThemeProvider";
import ToastContainer from "@/components/Toast";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Signal Clone",
  description: "Private messaging app",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="h-full overflow-hidden">
        <ThemeProvider />
        {children}
        <ToastContainer />
      </body>
    </html>
  );
}