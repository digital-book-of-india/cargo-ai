"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Eraser, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { MAX_POINTS, ZONE_PRESETS, clamp01 } from "@/lib/zone";
import { cn } from "@/lib/utils/cn";
import type { Point } from "@/types";

const W = 1600;

interface Props {
  points: Point[];
  onChange: (points: Point[]) => void;
  /** outline is not acceptable (crosses itself, too small, ...) */
  invalid?: boolean;
  disabled?: boolean;
  /** optional picture of the camera frame to draw over (an object URL kept in the browser) */
  backgroundUrl?: string;
  /** width / height of the canvas; 16:9 when not given */
  aspect?: number;
}

// Click on the picture area to add points, drag a point to move it, or use the keyboard:
// arrow keys nudge the selected point (Shift for bigger steps), Delete removes it.
export function ZoneEditor({ points, onChange, invalid, disabled, backgroundUrl, aspect = 16 / 9 }: Props) {
  const H = Math.round(W / aspect);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Always the newest points, even when several events arrive before React re-renders.
  const latest = useRef<Point[]>(points);
  latest.current = points;

  function commit(next: Point[]) {
    latest.current = next;
    onChange(next);
  }

  function toNormalized(e: { clientX: number; clientY: number }): Point {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: clamp01((e.clientX - rect.left) / rect.width),
      y: clamp01((e.clientY - rect.top) / rect.height),
    };
  }

  function addPoint(e: PointerEvent<SVGRectElement>) {
    const current = latest.current;
    if (disabled || current.length >= MAX_POINTS) return;
    commit([...current, toNormalized(e)]);
    setSelected(current.length);
  }

  function startDrag(e: PointerEvent<SVGGElement>, index: number) {
    if (disabled) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = index;
    setSelected(index);
  }

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const i = dragging.current;
    if (i === null || disabled) return;
    const next = latest.current.slice();
    if (!next[i]) return;
    next[i] = toNormalized(e);
    commit(next);
  }

  function onKey(e: KeyboardEvent<SVGGElement>, index: number) {
    if (disabled) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      const next = latest.current.slice();
      if (!next[index]) return;
      next[index] = { x: clamp01(next[index].x + dx), y: clamp01(next[index].y + dy) };
      commit(next);
    };
    if (e.key === "ArrowLeft") move(-step, 0);
    else if (e.key === "ArrowRight") move(step, 0);
    else if (e.key === "ArrowUp") move(0, -step);
    else if (e.key === "ArrowDown") move(0, step);
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      commit(latest.current.filter((_, i) => i !== index));
      setSelected(null);
    }
  }

  const px = (p: Point) => `${p.x * W},${p.y * H}`;
  const stroke = invalid ? "hsl(var(--destructive))" : "hsl(var(--primary))";

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-slate-900 shadow-card",
          invalid && "border-destructive"
        )}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          data-aspect={aspect.toFixed(3)}
          className={cn("block w-full touch-none select-none", disabled ? "opacity-70" : "cursor-crosshair")}
          onPointerMove={onMove}
          onPointerUp={() => (dragging.current = null)}
          onPointerCancel={() => (dragging.current = null)}
          role="group"
          aria-label="Shutter zone editor. Click to add points."
        >
          {/* neutral stand-in for the camera picture */}
          <rect width={W} height={H} fill="#0f172a" onPointerDown={addPoint} />
          {backgroundUrl && (
            <image
              href={backgroundUrl}
              width={W}
              height={H}
              preserveAspectRatio="none"
              opacity={0.85}
              pointerEvents="none"
            />
          )}
          {[1, 2].map((i) => (
            <g key={i} stroke="#334155" strokeWidth={2} strokeDasharray="10 10" pointerEvents="none">
              <line x1={(W / 3) * i} y1={0} x2={(W / 3) * i} y2={H} />
              <line x1={0} y1={(H / 3) * i} x2={W} y2={(H / 3) * i} />
            </g>
          ))}
          {!backgroundUrl && (
            <>
              <text x={24} y={44} fill="#64748b" fontSize={34} pointerEvents="none">
                Top of the camera picture
              </text>
              <text x={24} y={H - 24} fill="#64748b" fontSize={34} pointerEvents="none">
                Bottom
              </text>
            </>
          )}

          {points.length >= 3 && (
            <polygon
              points={points.map(px).join(" ")}
              fill={invalid ? "hsl(var(--destructive) / 0.25)" : "hsl(var(--primary) / 0.3)"}
              stroke={stroke}
              strokeWidth={5}
              strokeLinejoin="round"
              pointerEvents="none"
            />
          )}
          {points.length === 2 && (
            <polyline
              points={points.map(px).join(" ")}
              fill="none"
              stroke={stroke}
              strokeWidth={5}
              pointerEvents="none"
            />
          )}

          {points.map((p, i) => (
            <g
              key={i}
              tabIndex={disabled ? -1 : 0}
              role="button"
              aria-label={`Point ${i + 1} of ${points.length}. Arrow keys move it, Delete removes it.`}
              onPointerDown={(e) => startDrag(e, i)}
              onKeyDown={(e) => onKey(e, i)}
              onFocus={() => setSelected(i)}
              className="cursor-grab outline-none"
              style={{ touchAction: "none" }}
            >
              <circle cx={p.x * W} cy={p.y * H} r={80} fill="transparent" />
              <circle
                cx={p.x * W}
                cy={p.y * H}
                r={selected === i ? 30 : 24}
                fill="white"
                stroke={stroke}
                strokeWidth={7}
              />
              <text
                x={p.x * W}
                y={p.y * H + 10}
                textAnchor="middle"
                fontSize={30}
                fontWeight={700}
                fill="#0f172a"
                pointerEvents="none"
              >
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Quick start:</span>
        {ZONE_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              commit(preset.points.map((p) => ({ ...p })));
              setSelected(null);
            }}
          >
            {preset.label}
          </Button>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || points.length === 0}
          onClick={() => commit(latest.current.slice(0, -1))}
        >
          <Undo2 aria-hidden /> Undo last point
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || points.length === 0}
          onClick={() => {
            commit([]);
            setSelected(null);
          }}
        >
          <Eraser aria-hidden /> Clear
        </Button>
      </div>
    </div>
  );
}
