// The one place that speaks to /api/admin/*: JSON in/out, the CSRF header on
// every mutation, and the API's uniform error shape ({error, details}) as an
// ApiError. No module-level DOM/fetch access — Node imports this for tests.

let csrfToken = "";

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status; 0 means the request never left.
   * @param {string} message Human-readable, straight from the API's `error`.
   * @param {unknown} [details] Field-level issues ([{field,message}]) or an
   *   object like {updatedAt}/{storyId} for 409s.
   */
  constructor(status, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

/** app.js stores the token returned by GET /api/admin/session here. */
export function setCsrfToken(token) {
  csrfToken = String(token ?? "");
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") headers["X-CSRF-Token"] = csrfToken;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Network error — the API is unreachable.");
  }
  return parseResponse(response);
}

/** Shared JSON/error shaping for every response, raw uploads included. */
async function parseResponse(response) {
  // 401 from any authed route means the session died; callers bounce to login.
  if (response.status === 401) throw new ApiError(401, "Session expired.");

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message =
      data && typeof data.error === "string" ? data.error : `Request failed (HTTP ${response.status}).`;
    throw new ApiError(response.status, message, data && data.details !== undefined ? data.details : undefined);
  }
  return data;
}

export const getSession = () => request("/api/admin/session");
export const logout = () => request("/api/admin/logout", { method: "POST" });
export const listStories = (query) => request(`/api/admin/stories?${query}`);
export const createStory = (payload) => request("/api/admin/stories", { method: "POST", body: payload });
export const getStory = (id) => request(`/api/admin/stories/${id}`);
export const updateStory = (id, payload) => request(`/api/admin/stories/${id}`, { method: "PUT", body: payload });
export const deleteStory = (id) => request(`/api/admin/stories/${id}`, { method: "DELETE" });
export const restoreStory = (id) => request(`/api/admin/stories/${id}/restore`, { method: "POST" });

// ---- cover images (Phase 5) ------------------------------------------------
// The upload is the ONE call that isn't JSON-in: the image bytes go as the raw
// body with the file's own Content-Type (the server sniffs them anyway).

export const listImages = (storyId) => request(`/api/admin/stories/${storyId}/images`);

export async function uploadImage(storyId, file) {
  const headers = {};
  if (file && file.type) headers["Content-Type"] = file.type;
  headers["X-CSRF-Token"] = csrfToken;

  let response;
  try {
    response = await fetch(`/api/admin/stories/${storyId}/images`, { method: "POST", headers, body: file });
  } catch {
    throw new ApiError(0, "Network error — the API is unreachable.");
  }
  return parseResponse(response);
}

export const setImageCover = (storyId, imageId) =>
  request(`/api/admin/stories/${storyId}/images/${imageId}/cover`, { method: "POST" });
export const deleteImage = (storyId, imageId) =>
  request(`/api/admin/stories/${storyId}/images/${imageId}`, { method: "DELETE" });
