import type { Metadata } from "next";

// The title lives here because the page is a client module, which cannot export metadata.
export const metadata: Metadata = { title: "History" };

export default function RunsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
