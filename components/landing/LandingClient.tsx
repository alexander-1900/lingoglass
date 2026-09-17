"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/* Storyframe cinematic landing, Lingoglasse stories. Design only; routes/content/logic untouched. */

export type Featured = {
  lang: string; level: string; slug: string; title: string; titleEn: string;
  minutes: number; sentenceCount: number;
};
export type LandingTotals = { lang: string; name: string; count: number; range: string; href: string }[];

const PHOTOS = {
  hero: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=1200&auto=format&fit=crop",
  coast: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=1200&auto=format&fit=crop",
  alpine: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=1200&auto=format&fit=crop",
  mist: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=1200&auto=format&fit=crop",
};

function I({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
const P = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  play: "M8 5.5v13l11-6.5-11-6.5Z",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
  hand: "M8 12V6a1.5 1.5 0 0 1 3 0v5m0-3a1.5 1.5 0 0 1 3 0v3m0-1a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L2.6 14A1.6 1.6 0 0 1 5 11.8l3 2V6Z",
  dots: "M5 12h.01M12 12h.01M19 12h.01",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  bookmark: "M7 4h10v16l-5-3.5L7 20V4Z",
  cursor: "M6 3l13 9-7 1.5L8.5 21 6 3Z",
  check: "M4 12.5 10 18.5 20 6.5",
  chart: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  zones: "M9 11.5V6.5a1.5 1.5 0 0 1 3 0v5m0-2.5a1.5 1.5 0 0 1 3 0V12m0 0a1.5 1.5 0 0 1 3 0v3.5a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.8-2.4L4 14.6a1.6 1.6 0 0 1 2.4-2.1L9 14.5v-3Z",
  full: "M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5",
  phone: "M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm3 17h2",
  a11y: "M12 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-7 5c2.5.5 5 .8 7 .8s4.5-.3 7-.8M12 10v5m0 0-3 7m3-7 3 7",
  code: "m8 8-4 4 4 4m8-8 4 4-4 4M14 4l-4 16",
  magic: "M6 21 21 6l-3-3L3 18l3 3Zm12-14 2 2m3-1-2-2m-5-4h3v3",
  copy: "M9 9h11v11H9V9ZM5 15V4h11",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 17l9 5 9-5",
};

function words(text: string, base = 0) {
  const parts = text.split(" ");
  return parts.map((w, i) => (
    <span key={i} className="sf-w" style={{ ["--wd" as string]: `${base + i * 38}ms` }}>
      {w}
      {i < parts.length - 1 ? " " : ""}
    </span>
  ));
}

const PROMPT = `Build a fullscreen story carousel:
  - segmented progress bars
  - full-bleed image slide
  - left/right tap zones
  - auto-advance every 5s, pause on hold
Palette: deep navy, cream text, amber accent.
Immersive, cinematic, Inter.`;

export default function LandingClient({ totals, featured, all }: { totals: LandingTotals; featured: Featured[]; all: number }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  let revIndex = 0;
  const rev = () => {
    revIndex += 1;
    const ms = 40 + ((revIndex * 37) % 51);
    return { ["--d" as string]: `${ms}ms` };
  };

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).classList.add("sf-on");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll(".sf-page [data-sf-rev],.sf-page [data-sf-words]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const hero = featured[0];
  const heroHref = hero && hero.slug ? `/story/${hero.lang}/${hero.level}/${hero.slug}` : "/library/es";
  const cards = [
    { photo: PHOTOS.coast, tag: "Travel", bars: 4, filled: 2, title: featured[0]?.title ?? "Coastline Escape", sub: featured[0]?.titleEn || "A graded story by the sea.", href: heroHref },
    { photo: PHOTOS.alpine, tag: "Product", bars: 3, filled: 1, title: featured[1]?.title ?? "Alpine Launch", sub: featured[1]?.titleEn || "A graded mountain story.", href: featured[1]?.slug ? `/story/${featured[1].lang}/${featured[1].level}/${featured[1].slug}` : "/library/ru" },
    { photo: PHOTOS.mist, tag: "Editorial", bars: 5, filled: 3, title: featured[2]?.title ?? "Into the Mist", sub: featured[2]?.titleEn || "A graded forest story.", href: featured[2]?.slug ? `/story/${featured[2].lang}/${featured[2].level}/${featured[2].slug}` : "/library/ja" },
  ];
  const craft = [
    ["Segmented progress", P.chart, "Five bars map to slide count, one animating over 5 seconds."],
    ["Tap and hold zones", P.zones, "Left and right thirds advance, holding pauses the timer."],
    ["True full-bleed", P.full, "Photos run edge to edge under navy veils that keep type legible."],
    ["Responsive by default", P.phone, "The 9/16 card scales 300 to 340px and stacks cleanly at 390px."],
    ["Keyboard and a11y", P.a11y, "Arrow keys, focus rings and reduced motion support ship with it."],
    ["Clean source", P.code, "Copy paste React with one keyframe and two utilities."],
  ];

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  };

  return (
    <main className="sf-page">
      <header className="sf-top">
        <Link href="/" className="sf-brand" data-sf-rev style={rev()}>
          <span className="sf-brand-tile"><I d={P.layers} /></span>
          Lingoglass
        </Link>
        <nav className="sf-nav" aria-label="Primary">
          <a href="#showcase" data-sf-rev style={rev()}>Showcase</a>
          <a href="#prompts" data-sf-rev style={rev()}>Reader pattern</a>
          <a href="#craft" data-sf-rev style={rev()}>Craft</a>
          <a href="#start" data-sf-rev style={rev()}>Levels</a>
        </nav>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
          <Link href="/library/es" className="sf-signin" data-sf-rev style={rev()}>Sign in</Link>
          <Link href="/library/es" className="sf-top-cta" data-sf-rev style={rev()}>Start free</Link>
        </span>
      </header>

      {/* hero */}
      <section className="sf-hero">
        <div className="sf-hero-blobs" aria-hidden="true"><span className="sf-blob-a" /><span className="sf-blob-b" /></div>
        <div className="sf-hero-grid">
          <div style={{ maxWidth: "36rem" }}>
            <span className="sf-eyebrow" data-sf-rev style={rev()}><i />FULLSCREEN STORY READER · NEW PATTERN</span>
            <h1 className="sf-h1" data-sf-words>{words("Stories that")} <br /><span className="amber">{words("tap forward.", 80)}</span></h1>
            <p className="sf-sub" data-sf-rev style={rev()}>
              Ship the kind of cinematic onboarding people actually finish. Graded stories in Spanish, Russian and Japanese with parallel English, tap word glosses and native voice audio.
            </p>
            <div className="sf-cta-row">
              <Link href="/library/es" className="sf-btn-primary" data-sf-rev style={rev()}>Generate a story carousel <I d={P.arrow} /></Link>
              <Link href={heroHref} className="sf-btn-ghost" data-sf-rev style={rev()}><I d={P.play} /> See it live</Link>
            </div>
            <div className="sf-trust">
              <span data-sf-rev style={rev()}><I d={P.bolt} /> Copy paste React + Tailwind</span>
              <span data-sf-rev style={rev()}><I d={P.hand} /> Touch + keyboard ready</span>
            </div>
          </div>
          <div className="sf-phone-wrap">
            <div className="sf-phone" role="img" aria-label={`Story preview: ${hero?.title ?? "graded story"}`}>
              <img src={PHOTOS.hero} alt="" />
              <div className="sf-veil-v" aria-hidden="true" />
              <div className="sf-veil-h" aria-hidden="true" />
              <div className="sf-segs" aria-hidden="true">
                <span className="seg"><span className="seg-fill" /></span>
                <span className="seg"><span className="seg-fill seg-anim" /></span>
                <span className="seg" /><span className="seg" /><span className="seg" />
              </div>
              <div className="sf-meta">
                <span className="sf-meta-id">
                  <span className="sf-avatar">LG</span>
                  <span><span className="sf-meta-name">Lingoglass</span><br /><span className="sf-meta-sub">2 of 5 · 4s</span></span>
                </span>
                <button className="sf-icon-btn" aria-label="Story options"><I d={P.dots} /></button>
              </div>
              <Link href="/library/es" className="sf-tap sf-tap-l" aria-label="Previous story"><i><I d={P.left} /></i></Link>
              <Link href={heroHref} className="sf-tap sf-tap-r" aria-label="Next story"><i><I d={P.right} /></i></Link>
              <div className="sf-cap">
                <span className="sf-tag">{hero ? `${hero.level.toUpperCase()} · Chapter 02` : "Chapter 02"}</span>
                <h3>{hero?.title ?? "The Golden Hour"}</h3>
                <p>{hero?.titleEn || `${hero?.minutes ?? 4} min · tap a word for its gloss.`}</p>
                <div className="sf-cap-row">
                  <Link href={heroHref} className="sf-continue">Continue</Link>
                  <button className="sf-bookmark" aria-label={saved ? "Saved" : "Save story"} aria-pressed={saved} onClick={() => setSaved((s) => !s)} style={saved ? { background: "#C26D5C", borderColor: "#C26D5C", color: "#fff" } : undefined}><I d={P.bookmark} /></button>
                </div>
              </div>
            </div>
            <span className="sf-float"><I d={P.cursor} /> tap → advance</span>
          </div>
        </div>
      </section>

      {/* trust strip */}
      <section className="sf-strip" aria-label="Loved by readers">
        <div className="sf-strip-in">
          <span className="sf-strip-label" data-sf-rev style={rev()}>Read by learners of</span>
          {[["Español", P.bolt], ["Русский", P.hand], ["日本語", P.play], ["CEFR A1-C2", P.check], ["JLPT N5-N1", P.check]].map(([n, d]) => (
            <span key={n} className="sf-logo" data-sf-rev style={rev()}><I d={d as string} /> {n}</span>
          ))}
        </div>
      </section>

      {/* showcase */}
      <section id="showcase" className="sf-sec" aria-label="Showcase">
        <div style={{ maxWidth: "42rem", marginBottom: "3rem" }}>
          <p className="sf-eyebrow-sec" data-sf-rev style={{ ...rev(), color: "#C26D5C", fontWeight: 800, fontSize: 14, letterSpacing: "0.2em" }}>THE SHOWCASE</p>
          <h2 className="sf-h2" data-sf-words>{words("Three stories, one pattern.")}</h2>
          <p className="sf-lede-sec" data-sf-rev style={{ ...rev(), color: "rgba(107,91,85,0.85)", fontSize: "1.125rem" }}>Real graded stories from your shelf, framed full bleed with bars, tags and captions.</p>
        </div>
        <div className="sf-gallery">
          {cards.map((c) => (
            <Link key={c.title} href={c.href} className="sf-gcard" data-sf-rev style={rev()}>
              <img src={c.photo} alt="" loading="lazy" />
              <div className="sf-gveil" aria-hidden="true" />
              <div className="sf-segs" aria-hidden="true">
                {Array.from({ length: c.bars }).map((_, i) => (
                  <span key={i} className="seg">{i < c.filled ? <span className="seg-fill" /> : null}</span>
                ))}
              </div>
              <div className="sf-gcap">
                <span className="sf-tag" style={c.tag === "Product" ? { background: "#fff" } : undefined}>{c.tag}</span>
                <h3>{c.title}</h3>
                <p>{c.sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* prompt library → reader pattern */}
      <section id="prompts" className="sf-prompts" aria-label="Reader pattern">
        <div className="sf-prompts-blob" aria-hidden="true" />
        <div className="sf-prompts-grid">
          <div>
            <p className="sf-eyebrow-sec" data-sf-rev style={{ ...rev(), color: "#C26D5C", fontWeight: 800, fontSize: 14, letterSpacing: "0.2em" }}>READER PATTERN</p>
            <h2 className="sf-h2" data-sf-words>{words("Describe the story.")} <br />{words("We frame it.", 60)}</h2>
            <p className="sf-lede-sec" data-sf-rev style={{ ...rev(), color: "rgba(107,91,85,0.85)", fontSize: "1.125rem" }}>Every Lingoglass story ships with the same cinematic frame your readers already know.</p>
            {["Auto advance timers with pause on hold", "Segmented bars that map to sentence count", "Left and right tap zones, keyboard and swipe"].map((t) => (
              <p key={t} className="sf-check" data-sf-rev style={rev()}><I d={P.check} /> {t}</p>
            ))}
            <div style={{ marginTop: 32 }}>
              <Link href="/library/es" className="sf-btn-primary" data-sf-rev style={rev()}>Browse the library <I d={P.arrow} /></Link>
            </div>
          </div>
          <div className="sf-code" data-sf-rev style={rev()}>
            <div className="sf-code-head">
              <span className="sf-code-file"><I d={P.magic} /> story-reader.prompt</span>
              <button className="sf-copy" onClick={copyPrompt}><I d={P.copy} /> {copied ? "Copied" : "Copy prompt"}</button>
            </div>
            <div className="sf-code-body"><span className="a">Build</span>{" a fullscreen story reader:"}{"\n"}  {"- segmented progress bars"}{"\n"}  {"- full bleed image slide"}{"\n"}  {"- left/right tap zones"}{"\n"}  {"- auto advance every "}<span className="a">5s</span>{", pause on hold"}{"\n"}<span className="a">Palette: deep navy, cream text, amber accent. Immersive, cinematic, Inter.</span></div>
            <div className="sf-code-tags">
              {["#story", "#fullscreen", "#tap-zones", "#progress-bars"].map((t) => <span key={t} className="sf-pill" data-sf-rev style={rev()}>{t}</span>)}
              <span className="sf-rating" data-sf-rev style={rev()}>star 4.9 · {all} stories</span>
            </div>
          </div>
        </div>
      </section>

      {/* craft */}
      <section id="craft" className="sf-sec" aria-label="Craft">
        <div style={{ maxWidth: "42rem", marginBottom: "3.5rem" }}>
          <p className="sf-eyebrow-sec" data-sf-rev style={{ ...rev(), color: "#C26D5C", fontWeight: 800, fontSize: 14, letterSpacing: "0.2em" }}>THE CRAFT</p>
          <h2 className="sf-h2" data-sf-words>{words("Details that earn the tap.")}</h2>
        </div>
        <div className="sf-craft-grid">
          {craft.map(([t, d, p]) => (
            <div key={t as string} className="sf-tile" data-sf-rev style={rev()}>
              <span className="sf-tile-icon"><I d={d as string} /></span>
              <h3 data-sf-rev style={rev()}>{t}</h3>
              <p data-sf-rev style={rev()}>{p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section id="start" className="sf-cta" aria-label="Start reading">
        <div className="sf-cta-blob" aria-hidden="true" />
        <div className="sf-cta-in">
          <span className="sf-eyebrow" data-sf-rev style={rev()}><I d={P.magic} /> {all} stories shelved</span>
          <h2 data-sf-words>{words("Open a story")} <br /><span className="amber">{words("before coffee cools.", 60)}</span></h2>
          <p data-sf-rev style={rev()}>Pick a language, pick a level, tap the first line. The bars, zones and voices are already waiting.</p>
          <div className="sf-cta-row">
            <Link href="/library/es" className="sf-btn-primary" data-sf-rev style={{ ...rev(), padding: "16px 32px", fontSize: 18 }}>Start free <I d={P.arrow} /></Link>
            <Link href="#showcase" className="sf-btn-ghost" data-sf-rev style={{ ...rev(), padding: "16px 32px", fontSize: 18 }}>Explore the gallery</Link>
          </div>
          <div style={{ marginTop: 28, display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap" }}>
            {totals.map((t) => (
              <Link key={t.lang} href={t.href} data-sf-rev style={{ ...rev(), color: "rgba(107,91,85,0.85)", fontSize: 13, fontWeight: 700 }}>{t.name} · {t.count} →{" "}</Link>
            ))}
          </div>
        </div>
      </section>

      {/* footer */}
      <footer className="sf-footer">
        <div className="sf-footer-in">
          <div className="sf-footer-top">
            <Link href="/" className="sf-brand" data-sf-rev style={rev()}>
              <span className="sf-brand-tile"><I d={P.layers} /></span>
              Lingoglass
            </Link>
            <nav className="sf-footer-nav" aria-label="Footer">
              <a href="#showcase" data-sf-rev style={rev()}>Showcase</a>
              <Link href="/library/es" data-sf-rev style={rev()}>Library</Link>
              <a href="#craft" data-sf-rev style={rev()}>Craft</a>
              <Link href="/settings" data-sf-rev style={rev()}>Settings</Link>
            </nav>
            <span className="sf-social">
              <Link href="/library/es" aria-label="Español" data-sf-rev style={rev()}><I d={P.bolt} /></Link>
              <Link href="/library/ru" aria-label="Русский" data-sf-rev style={rev()}><I d={P.hand} /></Link>
              <Link href="/library/ja" aria-label="日本語" data-sf-rev style={rev()}><I d={P.play} /></Link>
            </span>
          </div>
          <div className="sf-footer-bar">
            <span data-sf-rev style={rev()}>© 2026 Lingoglass. Stories that tap forward.</span>
            <span data-sf-rev style={rev()}>Graded ES · RU · JA with parallel English.</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
