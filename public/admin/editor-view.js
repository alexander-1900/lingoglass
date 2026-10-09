// Story editor (Phase 4): metadata + sentence/word editing wired to the
// Phase 3 API. The optimistic lock is the contract: every save echoes the
// updatedAt that was loaded, and a 409 means something else changed the story.
// Client-side checks (story-form.js quickIssues) mirror functions/_lib/stories.ts
// for speed only — the server, including its render/parse round-trip check,
// stays authoritative and its field-level issues land under the same inputs.
// Stable hooks for the E2E browser drive: [data-path="slug"|"title"|"titleEn"|
// "minutes"|"lang"|"level"|"sentences[i].target"|…], .save, .trash, .restore,
// .add-sentence, .add-word, .remove-sentence, .remove-word.
import { ApiError, createStory, deleteStory, getStory, listImages, listStories, restoreStory, setImageCover, updateStory, uploadImage } from "./api.js";
import { el } from "./dom.js";
import {
  LANG_LABELS,
  LANGS,
  LIMITS,
  emptyFormState,
  emptySentence,
  emptyWord,
  formToPayload,
  formatEpoch,
  IMAGE_TYPES,
  imageIssue,
  issueMap,
  levelOptions,
  listApiQuery,
  quickIssues,
  storyToFormState,
  suggestedSlugPrefix,
} from "./story-form.js";

export function renderEditorView(container, ctx, route) {
  const isNew = route.name === "new";
  let state = emptyFormState();
  let baseline = JSON.stringify(formToPayload(state));
  let busy = false;
  let disposed = false;
  let leaving = false; // set before a navigation we initiated (no discard prompt)
  let loadFailed = false;
  let suggestSeq = 0;

  const noticeEl = el("p", { class: "notice", hidden: true });
  const headerEl = el("div", { class: "editor-head" });
  const metaEl = el("div", { class: "meta-grid" });
  const coverEl = el("section", { class: "cover-card" });
  const sentencesEl = el("div", { class: "sentences" });
  const footerEl = el("div", { class: "editor-foot" });

  const saveBtn = el("button", { type: "submit", class: "btn primary save", text: "Save" });
  const trashBtn = el("button", {
    type: "button",
    class: "btn danger trash",
    text: "Move to trash",
    onclick: () => void moveToTrash(),
  });
  const restoreBtn = el("button", {
    type: "button",
    class: "btn restore",
    text: "Restore",
    onclick: () => void restoreNow(),
  });
  const backBtn = el("button", {
    type: "button",
    class: "btn back",
    text: "← Back to stories",
    onclick: () => ctx.go("#/"),
  });

  const formEl = el(
    "form",
    {
      class: "editor",
      novalidate: "novalidate",
      onsubmit: (event) => {
        event.preventDefault();
        void save();
      },
    },
    [headerEl, metaEl, coverEl, sentencesEl, footerEl]
  );
  container.replaceChildren(noticeEl, formEl);

  // ---- notices --------------------------------------------------------------

  function showNotice(kind, message, buttons = []) {
    noticeEl.replaceChildren(
      el("span", { text: message }),
      ...buttons.map((b) => el("button", { type: "button", class: "btn small", text: b.label, onclick: b.onClick }))
    );
    noticeEl.className = `notice ${kind}`;
    noticeEl.hidden = false;
  }

  function hideNotice() {
    noticeEl.hidden = true;
  }

  function errorSlot(key) {
    return el("p", { class: "field-error", "data-err": key, hidden: true });
  }

  function clearErrors() {
    for (const node of container.querySelectorAll("[data-err]")) {
      node.textContent = "";
      node.hidden = true;
    }
  }

  /** Field-level issues → their inline slots; unrecognized fields are
   *  returned so the caller can surface them in the notice. */
  function applyIssueMap(map) {
    const leftovers = { ...map };
    for (const node of container.querySelectorAll("[data-err]")) {
      const key = node.getAttribute("data-err");
      if (map[key]) {
        node.textContent = map[key];
        node.hidden = false;
        delete leftovers[key];
      }
    }
    return Object.values(leftovers);
  }

  function field(labelText, control, errorKey, hintText) {
    return el("label", { class: "field" }, [
      el("span", { class: "field-label", text: labelText }),
      control,
      hintText ? el("span", { class: "field-hint", text: hintText }) : null,
      errorSlot(errorKey),
    ]);
  }

  const dirtyEl = el("span", { class: "muted small", text: "Saved" });
  const suggestBtn = el("button", {
    type: "button",
    class: "btn small suggest-slug",
    text: "Suggest slug",
    onclick: () => void suggestSlug(true),
  });

  // ---- metadata -------------------------------------------------------------

  const slugInput = el("input", {
    class: "input",
    "data-path": "slug",
    maxlength: String(LIMITS.slugMax),
    spellcheck: "false",
    autocapitalize: "none",
  });
  slugInput.addEventListener("input", () => {
    state.slug = slugInput.value;
    updateSummary();
  });
  const titleInput = el("input", {
    class: "input",
    "data-path": "title",
    maxlength: String(LIMITS.title),
  });
  const titleEnInput = el("input", {
    class: "input",
    "data-path": "titleEn",
    maxlength: String(LIMITS.title),
  });
  titleInput.addEventListener("input", () => {
    state.title = titleInput.value;
    updateSummary();
  });
  titleEnInput.addEventListener("input", () => {
    state.titleEn = titleEnInput.value;
    updateSummary();
  });
  const minutesInput = el("input", {
    class: "input",
    "data-path": "minutes",
    type: "number",
    min: String(LIMITS.minutesMin),
    max: String(LIMITS.minutesMax),
    step: "1",
    onchange: () => {
      state.minutes = minutesInput.value === "" ? Number.NaN : Number(minutesInput.value);
      minutesInput.value = Number.isFinite(state.minutes) ? String(state.minutes) : "";
    },
  });

  const langSel = el("select", {
    class: "input",
    "data-path": "lang",
    onchange: () => {
      state.lang = langSel.value;
      onLangChanged();
    },
  });
  for (const lang of LANGS) langSel.append(el("option", { value: lang, text: `${LANG_LABELS[lang]} (${lang})` }));

  const levelSel = el("select", {
    class: "input",
    "data-path": "level",
    onchange: () => {
      state.level = levelSel.value;
      if (isNew) void suggestSlug();
    },
  });

  function renderMeta() {
    headerEl.replaceChildren(
      el("h1", { text: isNew ? "New story" : state.title || "(untitled)" }),
      el("div", { class: "editor-sub" }, [
        el("span", { class: `badge ${state.status}`, text: state.status }),
        el("span", {
          class: "muted small",
          text: `${state.lang}/${state.level}/${state.slug || "…"} · v${state.updatedAt ?? 0} · created ${formatEpoch(
            state.createdAt
          )}`,
        }),
      ]),
      el("span", { class: "spacer" }),
      suggestBtn
    );

    metaEl.replaceChildren(
      field("Slug", slugInput, "slug", "lowercase NN-basename; ends up as the filename — never reuse a slug"),
      field("Title", titleInput, "title"),
      field("English title", titleEnInput, "titleEn"),
      field("Minutes", minutesInput, "minutes"),
      field("Language", langSel, "lang"),
      field("Level", levelSel, "level")
    );

    slugInput.value = state.slug;
    titleInput.value = state.title;
    titleEnInput.value = state.titleEn;
    minutesInput.value = Number.isFinite(state.minutes) ? String(state.minutes) : "";
    langSel.value = state.lang;
    levelSel.replaceChildren();
    for (const level of levelOptions(state.lang)) levelSel.append(el("option", { value: level, text: level }));
    levelSel.value = state.level;
  }

  function onLangChanged() {
    // The level select rebuilds from the language, so fix a stale level
    // FIRST — the slug suggestion query must carry a valid lang/level pair.
    if (!levelOptions(state.lang).includes(state.level)) {
      state.level = levelOptions(state.lang)[0];
    }
    renderMeta();
    if (isNew) void suggestSlug();
  }

  function sentenceCard(index) {
    const sentence = state.sentences[index];
    const targetInput = el("textarea", {
      class: "input",
      rows: "2",
      "data-path": `sentences[${index}].target`,
      maxlength: String(LIMITS.sentence),
    });
    targetInput.value = sentence.target;
    targetInput.addEventListener("input", () => {
      sentence.target = targetInput.value;
      updateSummary();
    });
    const enInput = el("input", {
      class: "input",
      "data-path": `sentences[${index}].en`,
      maxlength: String(LIMITS.sentence),
    });
    enInput.value = sentence.en;
    enInput.addEventListener("input", () => {
      sentence.en = enInput.value;
    });

    const wordsEl = el("div", { class: "words" });
    sentence.words.forEach((word, wordIndex) => wordsEl.append(wordRow(sentence, index, wordIndex, word)));

    return el("div", { class: "sentence", "data-sentence": String(index) }, [
      el("div", { class: "sentence-head" }, [
        el("span", { class: "sentence-no", text: `#${index + 1}` }),
        el("span", { class: "spacer" }),
        el("button", {
          type: "button",
          class: "btn small remove-sentence",
          text: "Remove sentence",
          onclick: () => removeSentence(index),
        }),
      ]),
      field("Sentence", targetInput, `sentences[${index}].target`),
      field("Translation", enInput, `sentences[${index}].en`),
      el("div", { class: "words-head" }, [
        el("span", { class: "field-label", text: `Glossary words (${sentence.words.length})` }),
        el("button", {
          type: "button",
          class: "btn small add-word",
          text: "＋ Add word",
          onclick: () => {
            sentence.words.push(emptyWord());
            renderSentences();
            focusPath(`sentences[${index}].words[${sentence.words.length - 1}].surface`);
          },
        }),
        errorSlot(`sentences[${index}].words`),
      ]),
      wordsEl,
    ]);
  }

  function wordRow(sentence, index, wordIndex, word) {
    const surface = el("input", {
      class: "input word-surface",
      placeholder: "surface",
      "data-path": `sentences[${index}].words[${wordIndex}].surface`,
      maxlength: String(LIMITS.surface),
    });
    surface.value = word.surface;
    surface.addEventListener("input", () => {
      word.surface = surface.value;
      updateSummary();
    });
    const note = el("input", {
      class: "input word-note",
      placeholder: "note (shown in the popover)",
      "data-path": `sentences[${index}].words[${wordIndex}].note`,
      maxlength: String(LIMITS.note),
    });
    note.value = word.note;
    note.addEventListener("input", () => {
      word.note = note.value;
    });
    return el("div", { class: "word-row" }, [
      surface,
      note,
      el("button", {
        type: "button",
        class: "btn small remove-word",
        text: "Remove",
        onclick: () => {
          sentence.words.splice(wordIndex, 1);
          renderSentences();
        },
      }),
      errorSlot(`sentences[${index}].words[${wordIndex}].surface`),
      errorSlot(`sentences[${index}].words[${wordIndex}].note`),
    ]);
  }

  function renderSentences() {
    sentencesEl.replaceChildren();
    state.sentences.forEach((_, index) => sentencesEl.append(sentenceCard(index)));
    sentencesEl.append(
      el("button", {
        type: "button",
        class: "btn add-sentence",
        text: "＋ Add sentence",
        onclick: () => {
          state.sentences.push(emptySentence());
          renderSentences();
          focusPath(`sentences[${state.sentences.length - 1}].target`);
        },
      })
    );
  }

  function removeSentence(index) {
    state.sentences.splice(index, 1);
    if (state.sentences.length === 0) state.sentences.push(emptySentence());
    renderSentences();
  }

  // ---- cover image ----------------------------------------------------------

  let images = []; // the story's gallery (cover first), as the API returns it
  let coverBusy = false;

  /** Re-read the gallery and keep state.coverImageId in step with it. */
  async function refreshImages() {
    if (isNew || state.id == null) return;
    try {
      const data = await listImages(state.id);
      if (disposed) return;
      images = Array.isArray(data.images) ? data.images : [];
      const cover = images.find((image) => image.isCover) ?? null;
      state.coverImageId = cover ? cover.id : null;
      renderCover();
    } catch (err) {
      // The gallery is optional context — a failed refresh must not wedge editing.
      if (!disposed && !ctx.handleApiError(err)) showNotice("error", err.message || "Could not load cover images.");
    }
  }

  async function uploadCover(file) {
    if (busy || coverBusy || state.id == null) return;
    coverBusy = true;
    hideNotice();
    renderCover();
    try {
      const data = await uploadImage(state.id, file);
      if (disposed) return;
      await refreshImages();
      showNotice("ok", data && data.image && data.image.isCover ? "Cover image uploaded." : "Image added to the gallery.");
    } catch (err) {
      if (!disposed && !ctx.handleApiError(err)) showNotice("error", err.message || "Upload failed.");
    } finally {
      coverBusy = false;
      if (!disposed) renderCover();
    }
  }

  async function pickCover(image) {
    if (busy || coverBusy || state.id == null) return;
    coverBusy = true;
    hideNotice();
    renderCover();
    try {
      await setImageCover(state.id, image.id);
      if (disposed) return;
      await refreshImages();
      showNotice("ok", "Cover updated.");
    } catch (err) {
      if (!disposed && !ctx.handleApiError(err)) showNotice("error", err.message || "Could not set the cover.");
    } finally {
      coverBusy = false;
      if (!disposed) renderCover();
    }
  }

  async function removeImage(image) {
    if (busy || coverBusy || state.id == null) return;
    if (!window.confirm("Remove this image?")) return;
    coverBusy = true;
    hideNotice();
    renderCover();
    try {
      await deleteImage(state.id, image.id);
      if (disposed) return;
      await refreshImages();
      showNotice("ok", "Image removed.");
    } catch (err) {
      if (!disposed && !ctx.handleApiError(err)) showNotice("error", err.message || "Could not remove the image.");
    } finally {
      coverBusy = false;
      if (!disposed) renderCover();
    }
  }

  /** The cover card: header + file picker, the current cover (or an empty
   *  state), and — when the gallery holds more than one image — a thumb per
   *  extra image with "Use as cover"/"Remove". Stable hooks for the E2E drive:
   *  .cover-card, .cover-upload, .cover-preview, .cover-thumb, .cover-pick,
   *  .cover-delete, .cover-remove. */
  function renderCover() {
    if (isNew || state.id == null) {
      coverEl.replaceChildren(
        el("span", { class: "field-label", text: "Cover image" }),
        el("p", { class: "muted small", text: "Save the story first — cover art uploads once it exists." })
      );
      return;
    }

    const cover = images.find((image) => image.isCover) ?? null;
    const input = el("input", { class: "cover-upload", type: "file", accept: IMAGE_TYPES.join(",") });
    input.disabled = coverBusy;
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.value = ""; // same file may be picked again after a failed try
      if (!file) return;
      const issue = imageIssue(file);
      if (issue) {
        showNotice("error", `Cover image ${issue}.`);
        return;
      }
      void uploadCover(file);
    });

    const head = el("div", { class: "cover-head" }, [
      el("span", { class: "field-label", text: "Cover image" }),
      el("span", { class: "spacer" }),
      input,
    ]);

    const preview = cover
      ? el("img", { class: "cover-preview", src: cover.url, alt: `Cover for ${state.title || "this story"}` })
      : el("p", { class: "muted small cover-empty", text: "No cover yet — upload a JPEG, PNG or WebP." });

    const extras = images.filter((image) => !image.isCover);
    const gallery =
      extras.length > 0
        ? el(
            "div",
            { class: "cover-gallery" },
            extras.map((image) =>
              el("div", { class: "cover-thumb" }, [
                el("img", { src: image.url, alt: "" }),
                el("div", { class: "cover-thumb-actions" }, [
                  el("button", {
                    type: "button",
                    class: "btn small cover-pick",
                    text: "Use as cover",
                    onclick: () => void pickCover(image),
                  }),
                  el("button", {
                    type: "button",
                    class: "btn small danger cover-delete",
                    text: "Remove",
                    onclick: () => void removeImage(image),
                  }),
                ]),
              ])
            )
          )
        : null;

    coverEl.replaceChildren(
      head,
      preview,
      cover
        ? el("div", { class: "cover-actions" }, [
            el("button", {
              type: "button",
              class: "btn small danger cover-remove",
              text: "Remove cover",
              onclick: () => void removeImage(cover),
            }),
          ])
        : null,
      gallery
    );
  }

  // ---- summary + focus ------------------------------------------------------

  function updateSummary() {
    // The dirty indicator is advisory; the save handler re-checks for real.
    dirtyEl.textContent = isDirty() ? "Unsaved changes" : "Saved";
    dirtyEl.className = isDirty() ? "dirty" : "muted small";
  }

  function focusPath(path) {
    const node = container.querySelector(`[data-path="${path}"]`);
    if (node && typeof node.focus === "function") node.focus();
  }

  function isDirty() {
    return JSON.stringify(formToPayload(state)) !== baseline;
  }

  // ---- load / save / trash --------------------------------------------------

  /** Re-fetch the story from the server and drop local edits (used after a
   *  409 conflict so the operator works from the changed state knowingly). */
  async function reloadFromServer() {
    try {
      const data = await getStory(state.id);
      if (disposed) return;
      Object.assign(state, storyToFormState(data.story));
      baseline = JSON.stringify(formToPayload(state));
      clearErrors();
      hideNotice();
      renderMeta();
      renderSentences();
      updateSummary();
      showNotice("info", "Reloaded the saved version — re-apply your edits.");
    } catch (err) {
      if (!disposed && !ctx.handleApiError(err)) showNotice("error", err.message || "Could not reload the story.");
    }
  }

  function conflictBanner() {
    showNotice("warn", "This story changed in another session — reload the saved version, then re-apply your edits.", [
      { label: "Reload saved version", onClick: () => void reloadFromServer() },
    ]);
  }

  async function save() {
    if (busy) return;
    hideNotice();
    clearErrors();
    const payload = formToPayload(state);

    const local = quickIssues(state);
    if (local.length > 0) {
      const leftovers = applyIssueMap(issueMap(local));
      showNotice("error", `Please fix ${local.length} field${local.length === 1 ? "" : "s"} before saving.`, [
        { label: "Show me", onClick: () => focusPath(local[0].field) },
      ]);
      if (leftovers.length > 0) console.warn("unmapped client issues", leftovers);
      return;
    }

    busy = true;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      if (isNew) {
        const data = await createStory(payload);
        if (disposed) return;
        state.id = data.story.id;
        state.updatedAt = data.story.updatedAt;
        state.status = data.story.status;
        baseline = JSON.stringify(formToPayload(state));
        leaving = true;
        ctx.flash(`Draft “${state.title}” created.`);
        ctx.go(`#/story/${state.id}`, { replace: true });
      } else {
        const data = await updateStory(state.id, { ...payload, updatedAt: state.updatedAt });
        if (disposed) return;
        Object.assign(state, storyToFormState(data.story));
        baseline = JSON.stringify(formToPayload(state));
        renderMeta();
        renderSentences();
        updateSummary();
        const note =
          state.status === "published"
            ? "Changes saved. The live site updates on the next publish."
            : "Changes saved.";
        showNotice("ok", note);
      }
    } catch (err) {
      if (disposed || ctx.handleApiError(err)) return;
      if (err instanceof ApiError && err.status === 409 && err.details && typeof err.details === "object" && "updatedAt" in err.details) {
        conflictBanner(); // optimistic-lock failure: the story moved on
      } else {
        showNotice("error", err.message || "Save failed.");
      }
    } finally {
      busy = false;
      saveBtn.disabled = loadFailed;
      saveBtn.textContent = "Save";
      updateSummary();
    }
  }

  async function moveToTrash() {
    if (busy) return;
    if (!window.confirm(`Move “${state.title}” to the trash? You can restore it from the Trash view.`)) return;
    busy = true;
    try {
      await deleteStory(state.id);
      if (disposed) return;
      leaving = true;
      ctx.flash(`Moved “${state.title}” to the trash.`);
      ctx.go("#/?deleted=1");
    } catch (err) {
      if (!disposed && !ctx.handleApiError(err)) showNotice("error", err.message || "Could not move the story to the trash.");
    } finally {
      busy = false;
    }
  }

  async function restoreNow() {
    if (busy) return;
    busy = true;
    try {
      await restoreStory(state.id);
      if (disposed) return;
      const fresh = await getStory(state.id);
      if (disposed) return;
      Object.assign(state, storyToFormState(fresh.story));
      baseline = JSON.stringify(formToPayload(state));
      renderMeta();
      renderSentences();
      updateSummary();
      showNotice("ok", "Restored — the story is live again.");
    } catch (err) {
      if (!disposed && !ctx.handleApiError(err)) showNotice("error", err.message || "Could not restore the story.");
    } finally {
      busy = false;
    }
  }

  // Soft API failures are handled per call site via ctx.handleApiError(err).

  // ---- slug suggestion ------------------------------------------------------

  /** Asks the list endpoint what "NN" the next story in this lang/level gets.
   *  Purely a convenience — failures stay silent, and a slug with no "NN-"
   *  prefix is only ever given one when the operator clicks Suggest. */
  async function suggestSlug(force = false) {
    const seq = ++suggestSeq;
    let data = null;
    try {
      data = await listStories(
        listApiQuery({ lang: state.lang, level: state.level, status: "all", q: "", deleted: false, offset: 0 })
      );
    } catch {
      return; // suggestion is optional; a failure must never block editing
    }
    if (disposed || seq !== suggestSeq) return;
    const prefix = suggestedSlugPrefix(data.nextSlugIndex);
    if (!prefix) return;
    const current = slugInput.value;
    if (!force && current !== "" && !/^\d{2}-/.test(current)) return; // custom slug: hands off
    state.slug = `${prefix}${current.replace(/^\d{2}-/, "")}`;
    slugInput.value = state.slug;
    updateSummary();
  }


  // ---- footer + load --------------------------------------------------------


  footerEl.append(el("span", { class: "spacer" }), dirtyEl, backBtn, trashBtn, restoreBtn, saveBtn);

  /** Trashed stories are read-only here (the API enforces the same rule). */
  function renderFooter() {
    const trashed = !isNew && state.deletedAt !== null;
    trashBtn.hidden = isNew || trashed;
    restoreBtn.hidden = !trashed;
    saveBtn.hidden = trashed || loadFailed;
    dirtyEl.hidden = trashed;
  }

  async function loadStory() {
    let data;
    try {
      data = await getStory(route.id);
    } catch (err) {
      if (disposed || ctx.handleApiError(err)) return;
      loadFailed = true;
      renderFooter();
      showNotice(
        "error",
        err.status === 404 ? "This story does not exist (or was deleted elsewhere)." : err.message || "Could not load the story."
      );
      return;
    }
    if (disposed) return;
    Object.assign(state, storyToFormState(data.story));
    baseline = JSON.stringify(formToPayload(state));
    renderMeta();
    renderSentences();
    renderFooter();
    updateSummary();
  }

  // ---- initial paint --------------------------------------------------------

  renderMeta();
  renderCover();
  renderSentences();
  renderFooter();
  updateSummary();
  if (isNew) void suggestSlug();
  else {
    void loadStory();
    void refreshImages();
  }

  return {
    dispose() {
      disposed = true;
    },
    /** The router asks before switching views; a false answer cancels. */
    canLeave() {
      if (leaving || !isDirty()) return true;
      return window.confirm("Discard unsaved changes to this story?");
    },
  };
}

