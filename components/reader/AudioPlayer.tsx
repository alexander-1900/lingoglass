"use client";

interface Props {
  playing: boolean;
  currentIdx: number;
  total: number;
  supported: boolean;
  onToggle: () => void;
  onSeek: (idx: number) => void;
}

/** Story transport: play/pause, sentence timeline, native-audio pill. */
export default function AudioPlayer({
  playing,
  currentIdx,
  total,
  supported,
  onToggle,
  onSeek,
}: Props) {
  if (total <= 0) return null;
  const percent = total > 1 ? (currentIdx / (total - 1)) * 100 : 0;

  const seekByRatio = (clientX: number, rect: DOMRect) => {
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(Math.round(ratio * (total - 1)));
  };

  return (
    <div className="glass-container audio-sync-footer">
      <div className="playback-controls">
        <button
          className="round-btn btn-play-pause"
          onClick={onToggle}
          disabled={!supported}
          aria-pressed={playing}
          aria-label={
            !supported
              ? "Audio is not supported in this browser"
              : playing
                ? "Pause story audio"
                : "Play story audio"
          }
          title={!supported ? "Audio is not supported in this browser" : "Play story audio"}
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>
      </div>

      <div className="audio-timeline-container">
        <span aria-hidden="true">{currentIdx + 1}</span>
        <div
          className="timeline-track-bg"
          role="slider"
          aria-label={`Sentence ${currentIdx + 1} of ${total}`}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={currentIdx + 1}
          tabIndex={0}
          onClick={(e) => seekByRatio(e.clientX, e.currentTarget.getBoundingClientRect())}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onSeek(currentIdx + 1);
            if (e.key === "ArrowLeft") onSeek(currentIdx - 1);
          }}
        >
          <div className="timeline-fill" style={{ width: `${percent}%` }} />
          <div className="timeline-handle" style={{ left: `${percent}%` }} />
        </div>
        <span aria-hidden="true">{total}</span>
      </div>

      <div className="pill-btn active" style={{ fontSize: "0.75rem", padding: "6px 12px" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
          <line x1="12" y1="19" x2="12" y2="22" />
        </svg>
        Native Audio Sync
      </div>
    </div>
  );
}
