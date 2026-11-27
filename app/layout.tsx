import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GOHOFog · Game Hub",
  description: "Play multiplayer games with friends, from social deduction to co-op mysteries."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}