"use client";

import type { ParallelMode } from "@/lib/settings";
import { MODES } from "@/lib/settings";

interface Props {
  mode: ParallelMode;
  onChange: (mode: ParallelMode) => void;
}

/** Target / interlinear-parallel / translation switcher. */
export default function ParallelToggle({ mode, onChange }: Props) {
  return (
    <div className="mode-toggle" role="group" aria-label="Text display mode">
      {MODES.map((o) => (
        <button
          key={o.id}
          className={`mode-btn ${mode === o.id ? "active" : ""}`}
          aria-pressed={mode === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
        >
          {o.id === "parallel" && <span className="en-badge">EN</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}
