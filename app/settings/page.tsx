import type { Metadata } from "next";
import AppShell from "@/components/shell/AppShell";
import SettingsForm from "@/components/settings/SettingsForm";
import { getAllStories } from "@/lib/stories";

// Private preferences page — keep it out of search indexes (and the sitemap).
export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default function SettingsPage() {
  return (
    <AppShell storyCount={getAllStories().length}>
      <SettingsForm />
    </AppShell>
  );
}
