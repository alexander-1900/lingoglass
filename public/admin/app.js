// Admin shell bootstrap (Phase 2): verify the session, expose the CSRF token
// for mutations, wire sign-out. All dynamic strings go through textContent.
(() => {
  const who = document.getElementById("who");
  const status = document.getElementById("status");
  const logout = document.getElementById("logout");
  if (!who || !status || !logout) return;

  let csrfToken = "";

  (async () => {
    try {
      const response = await fetch("/api/admin/session", {
        headers: { Accept: "application/json" },
      });
      if (response.status === 401) {
        location.assign("/admin/login");
        return;
      }
      if (!response.ok) {
        status.textContent = `Session check failed (HTTP ${response.status}).`;
        return;
      }
      const data = await response.json();
      csrfToken = String(data.csrfToken || "");
      who.textContent = `Signed in as ${String(data.username || "")}`;
      status.textContent = `Session valid — idle timeout ${Number(data.idleMinutes) || "?"} minutes.`;
    } catch {
      status.textContent = "Network error — could not reach the API.";
    }
  })();

  logout.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      const response = await fetch("/api/admin/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      });
      if (response.ok || response.status === 401) location.assign("/admin/login");
    } catch {
      status.textContent = "Sign-out failed (network error).";
    } finally {
      logout.disabled = false;
    }
  });
})();
