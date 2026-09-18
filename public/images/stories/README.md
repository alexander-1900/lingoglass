# Story cover photos — drop files here

Convention (automatic, no code changes needed):

```
public/images/stories/<slug>.jpg
```

- `<slug>` = story filename without `.md`
  - e.g. `content/es/a1/01-mi-rutina-diaria.md` → `01-mi-rutina-diaria.jpg`
- Accepted: `.jpg` `.jpeg` `.png` `.webp`
- Recommended size: **1200 × 630** (landscape), under ~300 KB.
- Card shows the photo cropped to a 130px-tall cover row (center-weighted
  `object-fit: cover`). The reader page itself doesn't display the cover (yet) —
  cards and link previews are where it appears.

Alternative — per-story override in frontmatter:

```md
---
title: Mi rutina diaria
title-en: My daily routine
lang: es
level: a1
image: /images/stories/mi-rutina.jpg
---
```

Use this when one photo should serve several stories, or for remote URLs
(e.g. `image: https://…`). Frontmatter always wins over the convention.

Until you add a photo, each story shows a designed placeholder
(lang monogram + “photo slot”) so nothing looks broken.
See `sample-cover.svg` — duplicate + rename it to `<slug>.svg`? No:
SVG placeholders are only an example; save real photos as `.jpg`.
