// Login page — no inline scripts (CSP), all dynamic text via textContent.
(() => {
  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("error");
  const submit = document.getElementById("submit");
  if (!(form instanceof HTMLFormElement) || !errorEl || !submit) return;

  const showError = (message) => {
    errorEl.textContent = message; // textContent, never innerHTML (A03)
    errorEl.hidden = false;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    submit.disabled = true;
    try {
      const username = String(form.elements.username.value || "").trim();
      const password = String(form.elements.password.value || "");
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (response.ok) {
        location.assign("/admin/");
        return;
      }
      if (response.status === 429) {
        const retry = response.headers.get("Retry-After");
        showError(
          retry
            ? `Too many attempts — try again in ${retry} seconds.`
            : "Too many attempts — try again later."
        );
      } else if (response.status === 401) {
        showError("Invalid username or password.");
      } else if (response.status === 403) {
        showError("Request rejected (origin check).");
      } else if (response.status >= 500) {
        showError("Server error — please try again.");
      } else {
        showError("Sign-in failed.");
      }
    } catch {
      showError("Network error — check your connection.");
    } finally {
      submit.disabled = false;
    }
  });
})();
