"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { Eraser, Undo2 } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { VisionCountDirection, VisionPoint, VisionZoneType } from "@dbi/api-types";

const W = 1600;

interface Props {
  zoneType: VisionZoneType;
  points: VisionPoint[];
  countDirection?: VisionCountDirection;
  onChange: (points: VisionPoint[]) => void;
  invalid?: boolean;
  disabled?: boolean;
  backgroundUrl?: string;
  aspect?: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function ZoneEditor({
  zoneType,
  points,
  countDirection = "A_TO_B",
  onChange,
  invalid,
  disabled,
  backgroundUrl,
  aspect = 16 / 9,
}: Props) {
  const H = Math.round(W / aspect);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const latest = useRef<VisionPoint[]>(points);
  latest.current = points;

  const isLine = zoneType === "counting_line";
  const maxPoints = isLine ? 2 : 100;

  function commit(next: VisionPoint[]) {
    latest.current = next;
    onChange(next);
  }

  function toNormalized(e: { clientX: number; clientY: number }): VisionPoint {
    const rect = svgRef.current!.getBoundingClientRect();
    return [
      clamp01((e.clientX - rect.left) / rect.width),
      clamp01((e.clientY - rect.top) / rect.height),
    ];
  }

  function addPoint(e: PointerEvent<SVGRectElement>) {
    const current = latest.current;
    if (disabled || current.length >= maxPoints) return;
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
      next[index] = [clamp01(next[index][0] + dx), clamp01(next[index][1] + dy)];
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

  const px = (p: VisionPoint) => `${p[0] * W},${p[1] * H}`;
  const stroke = invalid ? "hsl(var(--destructive))" : "hsl(var(--primary))";

  // Arrow calculations for counting line
  let arrowStart: [number, number] | null = null;
  let arrowEnd: [number, number] | null = null;
  if (isLine && points.length === 2) {
    const [pA, pB] = points;
    const midX = ((pA[0] + pB[0]) / 2) * W;
    const midY = ((pA[1] + pB[1]) / 2) * H;
    const dx = (pB[0] - pA[0]) * W;
    const dy = (pB[1] - pA[1]) * H;
    const len = Math.hypot(dx, dy) || 1;
    // Perpendicular vector (-dy, dx)
    const perpX = (-dy / len) * 70;
    const perpY = (dx / len) * 70;

    if (countDirection === "A_TO_B") {
      arrowStart = [midX - perpX, midY - perpY];
      arrowEnd = [midX + perpX, midY + perpY];
    } else if (countDirection === "B_TO_A") {
      arrowStart = [midX + perpX, midY + perpY];
      arrowEnd = [midX - perpX, midY - perpY];
    }
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-slate-950 shadow-card",
          invalid && "border-destructive"
        )}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={cn("block w-full touch-none select-none", disabled ? "opacity-70" : "cursor-crosshair")}
          onPointerMove={onMove}
          onPointerUp={() => (dragging.current = null)}
          onPointerCancel={() => (dragging.current = null)}
        >
          <defs>
            <marker
              id="dir-arrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
            </marker>
          </defs>

          <rect width={W} height={H} fill="#090d16" onPointerDown={addPoint} />

          {backgroundUrl && (
            <image
              href={backgroundUrl}
              width={W}
              height={H}
              preserveAspectRatio="none"
              opacity={0.8}
              pointerEvents="none"
            />
          )}

          {/* Grid lines */}
          {[1, 2].map((i) => (
            <g key={i} stroke="#1e293b" strokeWidth={2} strokeDasharray="8 8" pointerEvents="none">
              <line x1={(W / 3) * i} y1={0} x2={(W / 3) * i} y2={H} />
              <line x1={0} y1={(H / 3) * i} x2={W} y2={(H / 3) * i} />
            </g>
          ))}

          {/* Polygon representation */}
          {!isLine && points.length >= 3 && (
            <polygon
              points={points.map(px).join(" ")}
              fill={invalid ? "hsl(var(--destructive) / 0.25)" : "hsl(var(--primary) / 0.25)"}
              stroke={stroke}
              strokeWidth={5}
              strokeLinejoin="round"
              pointerEvents="none"
            />
          )}

          {/* Line representation */}
          {points.length >= 2 && (
            <polyline
              points={points.slice(0, 2).map(px).join(" ")}
              fill="none"
              stroke={isLine ? "#38bdf8" : stroke}
              strokeWidth={6}
              strokeDasharray={isLine ? "12 6" : undefined}
              pointerEvents="none"
            />
          )}

          {/* Line crossing direction arrow */}
          {arrowStart && arrowEnd && (
            <g pointerEvents="none">
              <line
                x1={arrowStart[0]}
                y1={arrowStart[1]}
                x2={arrowEnd[0]}
                y2={arrowEnd[1]}
                stroke="#38bdf8"
                strokeWidth={5}
                markerEnd="url(#dir-arrow)"
              />
              <text
                x={arrowEnd[0] + 15}
                y={arrowEnd[1] + 10}
                fill="#38bdf8"
                fontSize={32}
                fontWeight={700}
              >
                COUNT DIRECTION
              </text>
            </g>
          )}

          {/* Draggable point vertices */}
          {points.map((p, i) => {
            const label = isLine ? (i === 0 ? "A" : "B") : String(i + 1);
            return (
              <g
                key={i}
                tabIndex={disabled ? -1 : 0}
                role="button"
                aria-label={`Point ${label}`}
                onPointerDown={(e) => startDrag(e, i)}
                onKeyDown={(e) => onKey(e, i)}
                onFocus={() => setSelected(i)}
                className="cursor-grab outline-none"
                style={{ touchAction: "none" }}
              >
                <circle cx={p[0] * W} cy={p[1] * H} r={80} fill="transparent" />
                <circle
                  cx={p[0] * W}
                  cy={p[1] * H}
                  r={selected === i ? 28 : 22}
                  fill="#ffffff"
                  stroke={stroke}
                  strokeWidth={6}
                />
                <text
                  x={p[0] * W}
                  y={p[1] * H + 9}
                  textAnchor="middle"
                  fontSize={26}
                  fontWeight={800}
                  fill="#090d16"
                  pointerEvents="none"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || points.length === 0}
            onClick={() => commit(latest.current.slice(0, -1))}
          >
            <Undo2 className="mr-1 h-4 w-4" /> Undo point
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
            <Eraser className="mr-1 h-4 w-4" /> Clear
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {isLine
            ? "Click 2 points (A and B) across the transit corridor to create a counting line."
            : "Click at least 3 points to define the zone boundary. Drag points to adjust."}
        </p>
      </div>
    </div>
  );
}
