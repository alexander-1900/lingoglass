// Story list view (Phase 4): filter toolbar, table, pagination, and the two
// row actions (soft delete → trash, restore). Filters live in the URL hash
// ("#/?lang=ja&level=n5&…") so reloads and Back keep the working set.
// Stable hooks for the E2E browser drive: .new-story, .filter-lang/.filter-level/
// .filter-status/.filter-q/.filter-deleted, row[data-story-id], .edit-row,
// .trash-row, .restore-row, .page-prev/.page-next.
import { deleteStory, listStories, restoreStory } from "./api.js";
import { el } from "./dom.js";
import {
  LANG_LABELS,
  LANGS,
  LIMITS,
  PAGE_SIZE,
  filtersToHashQuery,
  formatEpoch,
  levelOptions,
  listApiQuery,
} from "./story-form.js";

const STATUS_LABELS = { all: "All statuses", draft: "Drafts", published: "Published" };

export function renderListView(container, ctx, initialFilters) {
  const filters = { ...initialFilters };
  let loadSeq = 0;
  let searchTimer = 0;

  const noticeEl = el("p", { class: "notice", hidden: true });
  const summaryEl = el("p", { class: "muted summary" });
  const tableWrap = el("div", { class: "table-wrap" });
  const pagerInfo = el("span", { class: "muted" });
  const prevBtn = el("button", {
    type: "button",
    class: "btn page-prev",
    text: "← Newer",
    onclick: () => commit({ offset: Math.max(0, filters.offset - PAGE_SIZE) }),
  });
  const nextBtn = el("button", {
    type: "button",
    class: "btn page-next",
    text: "Older →",
    onclick: () => commit({ offset: filters.offset + PAGE_SIZE }),
  });
  const pagerEl = el("div", { class: "pager" }, [prevBtn, pagerInfo, nextBtn]);

  // ---- toolbar --------------------------------------------------------------

  const langSel = el("select", {
    class: "input filter-lang",
    onchange: (event) => commit({ lang: event.target.value, level: "", offset: 0 }),
  });
  langSel.append(el("option", { value: "", text: "All languages" }));
  for (const lang of LANGS) langSel.append(el("option", { value: lang, text: `${LANG_LABELS[lang]} (${lang})` }));

  const levelSel = el("select", {
    class: "input filter-level",
    onchange: (event) => commit({ level: event.target.value, offset: 0 }),
  });

  const statusSel = el("select", {
    class: "input filter-status",
    onchange: (event) => commit({ status: event.target.value, offset: 0 }),
  });
  for (const [value, label] of Object.entries(STATUS_LABELS)) statusSel.append(el("option", { value, text: label }));

  const searchEl = el("input", {
    class: "input filter-q",
    type: "search",
    placeholder: "Search title or slug",
    maxlength: String(LIMITS.query),
    value: filters.q,
  });
  searchEl.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    // Debounce: typing should not fire one request per keystroke.
    searchTimer = window.setTimeout(
      () => commit({ q: searchEl.value.trim().slice(0, LIMITS.query), offset: 0 }),
      300
    );
  });

  const trashEl = el("input", {
    type: "checkbox",
    class: "filter-deleted",
    checked: filters.deleted,
    onchange: (event) => commit({ deleted: event.target.checked, offset: 0 }),
  });
  const trashTool = el("label", { class: "tool check" }, [trashEl, el("span", { text: "Trash" })]);

  const newBtn = el("button", {
    type: "button",
    class: "btn primary new-story",
    text: "＋ New story",
    onclick: () => ctx.go("#/new"),
  });

  const toolbarEl = el("div", { class: "toolbar" }, [
    tool("Language", langSel),
    tool("Level", levelSel),
    tool("Status", statusSel),
    tool("Search", searchEl),
    trashTool,
    el("span", { class: "spacer" }),
    newBtn,
  ]);

  container.replaceChildren(noticeEl, toolbarEl, summaryEl, tableWrap, pagerEl);

  // ---- state ⇄ hash ---------------------------------------------------------

  function tool(labelText, control) {
    return el("label", { class: "tool" }, [el("span", { class: "tool-label", text: labelText }), control]);
  }

  function fillLevels() {
    const levels = levelOptions(filters.lang);
    levelSel.replaceChildren(el("option", { value: "", text: "All levels" }));
    for (const level of levels) levelSel.append(el("option", { value: level, text: level }));
    levelSel.value = levels.includes(filters.level) ? filters.level : "";
    filters.level = levelSel.value;
  }

  function commit(patch) {
    Object.assign(filters, patch);
    langSel.value = filters.lang;
    fillLevels();
    statusSel.value = filters.status;
    trashEl.checked = filters.deleted;
    ctx.replaceHash(`#/${filtersToHashQuery(filters)}`);
    void load();
  }

  // ---- rendering ------------------------------------------------------------

  function showNotice(kind, message) {
    noticeEl.textContent = message;
    noticeEl.className = `notice ${kind}`;
    noticeEl.hidden = false;
  }

  function renderSummary(data) {
    const parts = [`${data.total} ${data.total === 1 ? "story" : "stories"}`];
    if (filters.deleted) parts.push("in trash");
    if (typeof data.nextSlugIndex === "string" && data.nextSlugIndex) {
      parts.push(`next order index ${data.nextSlugIndex}`);
    }
    summaryEl.textContent = parts.join(" · ");
  }

  function statusBadge(status) {
    return el("span", { class: `badge ${status}`, text: status });
  }

  function storyRow(story) {
    const lines = [el("span", { class: "story-title", text: story.title })];
    if (story.titleEn) lines.push(el("span", { class: "muted small", text: story.titleEn }));
    lines.push(el("code", { class: "slug", text: story.slug }));

    const cells = [];
    if (story.coverImageId) {
      // Lazy: only rows near the viewport fetch their bytes; 401s never happen
      // here because the session gate already wraps this page.
      cells.push(
        el("img", {
          class: "row-cover",
          src: `/api/admin/stories/${story.id}/images/${story.coverImageId}`,
          alt: "",
          loading: "lazy",
          width: "44",
          height: "60",
        })
      );
    }
    cells.push(el("div", { class: "story-lines" }, lines));

    const updatedCell = el("td", { class: "updated" }, [
      el("span", { text: formatEpoch(story.updatedAt) }),
      story.deletedAt !== null
        ? el("span", { class: "muted small", text: `trashed ${formatEpoch(story.deletedAt)}` })
        : null,
    ]);

    const actions = el("td", { class: "row-actions" });
    if (filters.deleted) {
      actions.append(
        el("button", {
          type: "button",
          class: "btn small restore-row",
          text: "Restore",
          onclick: (event) => {
            event.stopPropagation();
            void act("restore", story);
          },
        })
      );
    } else {
      actions.append(
        el("button", {
          type: "button",
          class: "btn small edit-row",
          text: "Edit",
          onclick: (event) => {
            event.stopPropagation();
            ctx.go(`#/story/${story.id}`);
          },
        }),
        el("button", {
          type: "button",
          class: "btn small danger trash-row",
          text: "Trash",
          onclick: (event) => {
            event.stopPropagation();
            void act("delete", story);
          },
        })
      );
    }

    const row = el("tr", { "data-story-id": String(story.id) }, [
      el("td", { class: "story-cell" }, cells),
      el("td", { class: "lang-cell", text: story.lang }),
      el("td", { class: "level-cell", text: story.level }),
      el("td", { class: "status-cell" }, [statusBadge(story.status)]),
      el("td", { class: "num", text: String(story.sentenceCount ?? "") }),
      updatedCell,
      actions,
    ]);
    if (!filters.deleted) {
      row.classList.add("clickable");
      row.addEventListener("click", () => ctx.go(`#/story/${story.id}`));
    }
    return row;
  }

  function renderTable(data) {
    if (!Array.isArray(data.stories) || data.stories.length === 0) {
      tableWrap.replaceChildren(
        el("p", { class: "muted", text: filters.deleted ? "Trash is empty." : "No stories match these filters." })
      );
      return;
    }
    const headers = ["Story", "Lang", "Level", "Status", "Sent.", "Updated", "Actions"];
    const thead = el("thead", {}, [el("tr", {}, headers.map((text) => el("th", { text })))]);
    const tbody = el("tbody");
    for (const story of data.stories) tbody.append(storyRow(story));
    tableWrap.replaceChildren(el("table", { class: "stories" }, [thead, tbody]));
  }

  function renderPager(data) {
    const start = data.stories.length === 0 ? 0 : filters.offset + 1;
    const end = filters.offset + data.stories.length;
    pagerInfo.textContent = `${start}–${end} of ${data.total}`;
    prevBtn.disabled = filters.offset === 0;
    nextBtn.disabled = end >= data.total;
  }

  async function load() {
    const seq = ++loadSeq;
    tableWrap.replaceChildren(el("p", { class: "muted", text: "Loading…" }));
    let data;
    try {
      data = await listStories(listApiQuery(filters));
    } catch (err) {
      if (ctx.handleApiError(err) || seq !== loadSeq || ctx.isStale()) return;
      tableWrap.replaceChildren(el("p", { class: "notice error", text: err.message || "Could not load stories." }));
      return;
    }
    if (seq !== loadSeq || ctx.isStale()) return;
    renderSummary(data);
    renderTable(data);
    renderPager(data);
  }

  async function act(kind, story) {
    if (kind === "delete" && !window.confirm(`Move “${story.title}” to the trash?`)) return;
    try {
      if (kind === "delete") {
        await deleteStory(story.id);
        showNotice("ok", `Moved “${story.title}” to the trash.`);
      } else {
        const result = await restoreStory(story.id);
        showNotice("ok", result && result.restored ? `Restored “${story.title}”.` : `“${story.title}” was already live.`);
      }
      void load();
    } catch (err) {
      if (ctx.handleApiError(err)) return;
      showNotice("error", err.message || "Action failed.");
    }
  }

  // ---- initial paint --------------------------------------------------------

  langSel.value = filters.lang;
  fillLevels();
  statusSel.value = filters.status;
  trashEl.checked = filters.deleted;
  void load();

  return {
    dispose() {
      loadSeq += 1;
      window.clearTimeout(searchTimer);
    },
    canLeave: () => true, // the list holds no unsaved state
  };
}

