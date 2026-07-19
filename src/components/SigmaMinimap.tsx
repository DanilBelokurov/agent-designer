// Bottom-right minimap overlay for Sigma.js v3. Renders a 180×140 canvas
// showing every visible node as a 1.5 px dot, plus a translucent
// rectangle representing the current camera viewport.
//
// Click on the minimap recenters the main canvas. We subscribe to
// `camera.updated` so the viewport box follows pan/zoom without
// polling. The renderer instance is passed in via props — SigmaGraphCanvas
// owns the imperative ref and forwards it down, avoiding the global
// DOM-attribute trick.

import { useEffect, useRef } from 'react';
import type Sigma from 'sigma';
import type Graph from 'graphology';
import { useCodeGraphStore } from '../store/useCodeGraphStore';
import type { CodeEntity } from '../services/codeIntel/types';

const WIDTH = 180;
const HEIGHT = 140;
const DOT_RADIUS = 1.5;
const VIEWPORT_FILL = 'rgba(78, 161, 243, 0.18)';
const VIEWPORT_STROKE = 'rgba(78, 161, 243, 0.85)';

export interface SigmaMinimapProps {
  renderer: Sigma | null;
}

export default function SigmaMinimap({ renderer }: SigmaMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const state = useCodeGraphStore((s) => s.state);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderer || !state) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const entities: CodeEntity[] = state.entities;

    function paint() {
      if (!ctx || !renderer || !canvas) return;
      const graph = renderer.getGraph();
      const bbox = getBoundingBox(entities, graph);
      const scale = Math.min(WIDTH / bbox.width, HEIGHT / bbox.height);
      const offsetX = (WIDTH - bbox.width * scale) / 2 - bbox.minX * scale;
      const offsetY = (HEIGHT - bbox.height * scale) / 2 - bbox.minY * scale;

      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
      for (const e of entities) {
        if (!graph.hasNode(e.id)) continue;
        const x = graph.getNodeAttribute(e.id, 'x') as number;
        const y = graph.getNodeAttribute(e.id, 'y') as number;
        ctx.beginPath();
        ctx.arc(offsetX + x * scale, offsetY + y * scale, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }

      const camera = renderer.getCamera();
      const view = computeViewportRect(camera.getState(), scale, offsetX, offsetY);
      ctx.fillStyle = VIEWPORT_FILL;
      ctx.strokeStyle = VIEWPORT_STROKE;
      ctx.lineWidth = 1;
      ctx.fillRect(view.x, view.y, view.width, view.height);
      ctx.strokeRect(view.x, view.y, view.width, view.height);
    }

    paint();
    const handler = () => paint();
    renderer.getCamera().on('updated', handler);
    return () => {
      renderer.getCamera().removeListener('updated', handler);
    };
  }, [renderer, state]);

  function onClick(ev: React.MouseEvent<HTMLCanvasElement>) {
    if (!renderer || !state) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const graph = renderer.getGraph();
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const bbox = getBoundingBox(state.entities, graph);
    const scale = Math.min(WIDTH / bbox.width, HEIGHT / bbox.height);
    const offsetX = (WIDTH - bbox.width * scale) / 2 - bbox.minX * scale;
    const offsetY = (HEIGHT - bbox.height * scale) / 2 - bbox.minY * scale;
    const gx = (x - offsetX) / scale;
    const gy = (y - offsetY) / scale;
    const camera = renderer.getCamera();
    camera.animate({ x: gx, y: gy }, { duration: 300 });
  }

  if (!state) return null;

  return (
    <div className="absolute bottom-4 right-4 z-20 rounded-xl overflow-hidden bg-slate-900/90 border border-slate-700/60 backdrop-blur-md shadow-2xl pointer-events-auto">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        onClick={onClick}
        className="cursor-crosshair block"
      />
    </div>
  );
}

interface BBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function getBoundingBox(entities: CodeEntity[], graph: Graph): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of entities) {
    if (!graph.hasNode(e.id)) continue;
    const x = graph.getNodeAttribute(e.id, 'x') as number;
    const y = graph.getNodeAttribute(e.id, 'y') as number;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) {
    return { minX: 0, minY: 0, width: 1, height: 1 };
  }
  const padX = (maxX - minX) * 0.05;
  const padY = (maxY - minY) * 0.05;
  return {
    minX: minX - padX,
    minY: minY - padY,
    width: maxX - minX + 2 * padX,
    height: maxY - minY + 2 * padY,
  };
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeViewportRect(
  cam: { x: number; y: number; ratio: number; width?: number; height?: number },
  scale: number,
  offsetX: number,
  offsetY: number,
): Rect {
  const w = (cam.width ?? 1) / cam.ratio;
  const h = (cam.height ?? 1) / cam.ratio;
  return {
    x: offsetX + (cam.x - w / 2) * scale,
    y: offsetY + (cam.y - h / 2) * scale,
    width: w * scale,
    height: h * scale,
  };
}
