import { getAllStories } from "@/lib/stories";
import AppShell from "@/components/shell/AppShell";
import LibraryExplorer from "@/components/library/LibraryExplorer";

export default function Home() {
  const stories = getAllStories();
  return (
    <AppShell storyCount={stories.length}>
      <section id="stories-platform" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <LibraryExplorer stories={stories} scopeLang="all" scopeLevel="all" mode="state" />
      </section>
    </AppShell>
  );
}
