"use client";

import { IconNext, IconPlay, IconPrev, IconStop } from "../ui/icons";

interface Props {
  playing: boolean;
  currentIdx: number;
  total: number;
  rate: number;
  speeds: number[];
  supported: boolean;
  onToggle: () => void;
  onSeek: (idx: number) => void;
  onStep: (delta: number) => void;
  onRate: (rate: number) => void;
}

/** Story transport: play/stop, sentence scrubber, speed control. */
export default function AudioPlayer({
  playing,
  currentIdx,
  total,
  rate,
  speeds,
  supported,
  onToggle,
  onSeek,
  onStep,
  onRate,
}: Props) {
  if (total <= 0) return null;
  return (
    <div className="player" role="group" aria-label="Story audio controls">
      <div className="player-row">
        <button
          className="player-step"
          onClick={() => onStep(-1)}
          disabled={currentIdx <= 0}
          aria-label="Previous sentence"
          title="Previous sentence"
        >
          <IconPrev />
        </button>
        <button
          className={`btn btn-listen ${playing ? "playing" : ""}`}
          onClick={onToggle}
          disabled={!supported}
          aria-pressed={playing}
          aria-label={
            !supported
              ? "Audio is not supported in this browser"
              : playing
                ? "Stop reading aloud"
                : "Listen to the whole story"
          }
          title={!supported ? "Audio is not supported in this browser" : undefined}
        >
          {playing ? <IconStop /> : <IconPlay />}
          <span>{playing ? "Stop" : "Listen"}</span>
        </button>
        <button
          className="player-step"
          onClick={() => onStep(1)}
          disabled={currentIdx >= total - 1}
          aria-label="Next sentence"
          title="Next sentence"
        >
          <IconNext />
        </button>
        <span className="player-pos" aria-live="polite">
          {currentIdx + 1} / {total}
        </span>
      </div>

      <div className="player-row">
        <label className="player-scrub" aria-label={`Sentence ${currentIdx + 1} of ${total}`}>
          <span className="player-scrub-cap">1</span>
          <input
            type="range"
            min={0}
            max={total - 1}
            step={1}
            value={currentIdx}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-valuetext={`Sentence ${currentIdx + 1} of ${total}`}
          />
          <span className="player-scrub-cap">{total}</span>
        </label>
      </div>

      <div className="player-row">
        <span className="player-speed-label" id="speed-label">
          Speed
        </span>
        <div className="player-speeds" role="group" aria-labelledby="speed-label">
          {speeds.map((s) => (
            <button
              key={s}
              className={`player-speed ${s === rate ? "active" : ""}`}
              onClick={() => onRate(s)}
              aria-pressed={s === rate}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
