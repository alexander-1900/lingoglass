// Admin shell (Phase 4): session bootstrap, CSRF hand-off, the hash router and
// the two views renderListView()/renderEditorView(). Every /api/admin/* route
// is session-gated; a 401 anywhere drops straight back to the login page, and
// no dynamic string ever goes through innerHTML.
//
// Route table (hash-based so /admin/index.html itself stays a static asset
// behind the session gate):
//   #/             story list (filters ride in the hash: #/?lang=ja&level=n5…)
//   #/new          create-story editor
//   #/story/:id    editor for one story (id must be a positive integer)
import { ApiError, getSession, logout, setCsrfToken } from "./api.js";
import { renderEditorView } from "./editor-view.js";
import { renderListView } from "./list-view.js";
import { filtersFromHashQuery } from "./story-form.js";

/** "#/story/12?x=1" → {name:"story", id:12}; unknown → {name:"notfound"}.
 *  Every route carries `id` (null when meaningless) so callers read it flat. */
export function routeOf(hash) {
  const raw = String(hash ?? "");
  const h = raw.startsWith("#") ? raw.slice(1) : raw;
  if (h === "" || h === "/" || h.startsWith("/?")) return { name: "list", id: null };
  if (h === "/new") return { name: "new", id: null };
  const m = h.match(/^\/story\/(\d{1,10})(?:\?.*)?$/);
  if (m) {
    const id = Number(m[1]);
    if (Number.isSafeInteger(id) && id >= 1) return { name: "story", id };
  }
  return { name: "notfound", id: null };
}

/** The query part of any hash, filters included: "#/?a=1" → "?a=1". */
export function hashQueryOf(hash) {
  const raw = String(hash ?? "");
  const idx = raw.indexOf("?");
  return idx === -1 ? "" : raw.slice(idx);
}

// The import itself must work headlessly (tests import routeOf above); only a
// real browser gets to touch DOM/network here.
if (typeof document !== "undefined") main();

function main() {
  const viewEl = document.getElementById("view");
  const whoEl = document.getElementById("who");
  const logoutBtn = document.getElementById("logout");
  const bannerEl = document.getElementById("banner");
  if (!viewEl) return;

  let viewToken = 0;
  let current = null; // active view ({dispose, canLeave} | null)
  let renderedHash = null; // hash of the last successfully started view
  let flashMessage = "";
  let bannerTimer = 0;

  function showBanner(kind, message) {
    if (!bannerEl) return;
    window.clearTimeout(bannerTimer);
    bannerEl.textContent = message;
    bannerEl.className = `banner ${kind}`;
    bannerEl.hidden = false;
    bannerTimer = window.setTimeout(() => {
      bannerEl.hidden = true;
    }, 6000);
  }

  function handleApiError(err) {
    if (err instanceof ApiError && err.status === 401) {
      location.assign("/admin/login");
      return true;
    }
    return false;
  }

  function go(hash, opts = {}) {
    if (opts.replace) {
      history.replaceState(null, "", location.pathname + location.search + hash);
      renderedHash = hash;
      void render();
      return;
    }
    if (location.hash === hash) {
      void render(); // same hash would not fire hashchange
      return;
    }
    location.hash = hash; // the hashchange listener renders
  }


  async function render() {
    const route = routeOf(location.hash);
    if (route.name === "notfound") {
      history.replaceState(null, "", location.pathname + location.search + "#/");
      renderedHash = "#/";
      void render();
      return;
    }

    const previous = current;
    if (previous && typeof previous.canLeave === "function" && !previous.canLeave()) {
      // The outgoing view vetoed the switch (unsaved edits) — restore the hash.
      history.replaceState(null, "", location.pathname + location.search + (renderedHash ?? "#/"));
      return;
    }
    const localToken = ++viewToken;
    if (previous && typeof previous.dispose === "function") previous.dispose();
    current = null;

    const loadingEl = document.createElement("p");
    loadingEl.className = "muted";
    loadingEl.textContent = "Loading…";
    viewEl.replaceChildren(loadingEl);

    const ctx = {
      /** True once a newer render superseded this view's async work. */
      isStale: () => localToken !== viewToken,
      handleApiError,
      go,
      /** Update the URL (filters, deep links) without re-rendering. */
      replaceHash(hash) {
        history.replaceState(null, "", location.pathname + location.search + hash);
        renderedHash = hash;
      },
      /** Message to show once the next view has been rendered. */
      flash(message) {
        flashMessage = String(message ?? "");
      },
      showBanner,
    };

    try {
      current =
        route.name === "list"
          ? renderListView(viewEl, ctx, filtersFromHashQuery(hashQueryOf(location.hash)))
          : renderEditorView(viewEl, ctx, route);
    } catch (err) {
      if (!handleApiError(err)) showBanner("error", (err && err.message) || "The view failed to render.");
      return;
    }

    if (localToken !== viewToken) return;
    renderedHash = location.hash;
    if (flashMessage) {
      showBanner("ok", flashMessage);
      flashMessage = "";
    }
  }

  async function boot() {
    try {
      const session = await getSession();
      setCsrfToken(session.csrfToken);
      if (whoEl) whoEl.textContent = `Signed in as ${String(session.username ?? "")}`;
    } catch {
      location.assign("/admin/login");
      return;
    }
    // Canonicalize: empty/unknown hashes go to the list; deep links stay put.
    if (location.hash === "" || routeOf(location.hash).name === "notfound") {
      history.replaceState(null, "", location.pathname + location.search + "#/");
    }
    renderedHash = location.hash;
    window.addEventListener("hashchange", () => {
      void render();
    });
    void render();
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      logoutBtn.disabled = true;
      try {
        await logout();
      } catch {
        /* the cookie may already be gone — go to the login page either way */
      }
      location.assign("/admin/login");
    });
  }

  void boot();
}
