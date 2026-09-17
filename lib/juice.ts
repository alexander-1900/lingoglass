"use client";

/* Celebration particles, ghost-flight bookmark animation, and toast alerts.
   Same behavior as the reference design; DOM-only, no dependencies. */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
  gravity: number;
}

const COLORS = ["#C26D5C", "#C48F45", "#5A7A68", "#D37B7B", "#9E8D85"];

let ctx: CanvasRenderingContext2D | null = null;
let canvas: HTMLCanvasElement | null = null;
let particles: Particle[] = [];
let loopOn = false;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Start the fullscreen particle loop. Call once from the app shell. */
export function initParticles(): void {
  if (typeof window === "undefined" || loopOn) return;
  canvas = document.getElementById("particle-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  const resize = () => {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener("resize", resize);
  ctx = canvas.getContext("2d");
  loopOn = true;
  const tick = () => {
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.alpha -= p.decay;
        if (!ctx) return false;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return p.alpha > 0;
      });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Celebration burst at viewport coordinates (e.g. above the saved word). */
export function celebrationBurst(x: number, y: number, count = 30): void {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const velocity = 3 + Math.random() * 8;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity - (2 + Math.random() * 3),
      radius: 3 + Math.random() * 4,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 1,
      decay: 0.015 + Math.random() * 0.02,
      gravity: 0.18,
    });
  }
}

/** Fly a ghost copy of the word to the sidebar badge (matched geometry). */
export function ghostFlight(text: string, startX: number, startY: number): void {
  if (typeof document === "undefined") return;
  const badge = document.getElementById("vocab-badge-count");
  const ghost = document.createElement("div");
  ghost.className = "ghost-token";
  ghost.textContent = text || "Word";
  ghost.style.left = `${startX}px`;
  ghost.style.top = `${startY}px`;
  document.body.appendChild(ghost);

  let destX = startX;
  let destY = startY - 160;
  if (badge) {
    const r = badge.getBoundingClientRect();
    destX = r.left - 10;
    destY = r.top;
  }
  const anim = ghost.animate(
    [
      { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1 },
      {
        transform: `translate(${(destX - startX) * 0.5}px, ${(destY - startY) * 0.4 - 150}px) scale(1.3) rotate(-15deg)`,
        opacity: 0.9,
      },
      {
        transform: `translate(${destX - startX}px, ${destY - startY}px) scale(0.3) rotate(30deg)`,
        opacity: 0,
      },
    ],
    { duration: 800, easing: "cubic-bezier(0.25, 1, 0.50, 1)" }
  );
  anim.onfinish = () => ghost.remove();
}

/** Floating toast alert (bottom-right HUD card). */
export function toast(title: string, description: string, ms = 4500): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById("pace-notification");
  if (!el) return;
  if (toastTimer) {
    clearTimeout(toastTimer);
    el.classList.remove("show");
  }
  const t = el.querySelector(".notification-title");
  const d = el.querySelector(".notification-desc");
  if (t) t.textContent = title;
  if (d) d.textContent = description;
  el.classList.add("show");
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}
