import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import AuthCard from "@/components/auth/AuthCard";
import { getAllStories } from "@/lib/stories";

// Private account page — keep it out of search indexes (and the sitemap).
export const metadata: Metadata = {
  title: "Log in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  return (
    <AppShell storyCount={getAllStories().length}>
      <section id="stories-platform" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <AuthCard mode="login" callbackUrl={sp.callbackUrl} error={sp.error} />
      </section>
    </AppShell>
  );
}
