import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GOHOFog · Game Hub",
  description: "Play multiplayer games with friends. Start with Werewolf."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="id"><body>{children}</body></html>;
}