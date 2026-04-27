import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { AppProviders } from "@/providers/app-providers";
import { Header } from "@/components/Header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clarity",
  description: "Agent job marketplace on Base",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieHeader = (await headers()).get("cookie");
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased text-zinc-900`}
      >
        <AppProviders cookies={cookieHeader}>
          <Header />
          <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
