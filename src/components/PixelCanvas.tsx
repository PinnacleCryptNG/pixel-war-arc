import { useRef, useEffect, useCallback, useState } from 'react';

const GRID = 100;
const UNOWNED_COLOR = '#12183a';

export interface PixelData {
  owner: string;
  color: number;
  price: bigint;
}

interface Props {
  pixels: (PixelData | null)[];
  selectedIds: Set<number>;
  paintColor: string;
  onSelect: (id: number) => void;
  loading: boolean;
}

function numToHex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function ZoomBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onMouseDown={e => e.stopPropagation()}
      onTouchStart={e => e.stopPropagation()}
      onClick={onClick}
      className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold"
      style={{ background: 'var(--glass)', color: 'var(--ink-2)', border: '1px solid var(--border-2)', backdropFilter: 'blur(8px)' }}
    >
      {label}
    </button>
  );
}

export function PixelCanvas({ pixels, selectedIds, paintColor, onSelect, loading }: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // zoom & pan — pan is the offset of the canvas top-left inside the container
  const [zoom, setZoom] = useState(1);
  const panRef = useRef({ x: 0, y: 0 });
  const [panState, setPanState] = useState({ x: 0, y: 0 });

  // drag tracking (refs = no re-render stutter)
  const dragStart    = useRef<{ x: number; y: number } | null>(null);
  const dragMoved    = useRef(false);

  // pinch tracking
  const pinchDist = useRef<number | null>(null);

  // ─── compute pixel size from container + zoom ──────────────────────
  const getPs = useCallback((): number => {
    const c = containerRef.current;
    if (!c) return 6;
    return (Math.min(c.clientWidth, c.clientHeight) / GRID) * zoom;
  }, [zoom]);

  // ─── clamp pan so canvas never drifts fully off-screen ────────────
  const clamp = useCallback((px: number, py: number, z: number) => {
    const cont = containerRef.current;
    if (!cont) return { x: px, y: py };
    const ps  = (Math.min(cont.clientWidth, cont.clientHeight) / GRID) * z;
    const cw  = GRID * ps, ch = GRID * ps;
    const minX = Math.min(0, cont.clientWidth  - cw);
    const minY = Math.min(0, cont.clientHeight - ch);
    return {
      x: Math.max(minX, Math.min(0, px)),
      y: Math.max(minY, Math.min(0, py)),
    };
  }, []);

  const applyPan = useCallback((px: number, py: number, z: number) => {
    const clamped = clamp(px, py, z);
    panRef.current = clamped;
    setPanState(clamped);
  }, [clamp]);

  // ─── draw ─────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ps = getPs();
    canvas.width  = GRID * ps;
    canvas.height = GRID * ps;

    for (let i = 0; i < GRID * GRID; i++) {
      const col = i % GRID, row = Math.floor(i / GRID);
      const x = col * ps, y = row * ps;
      const px = pixels[i];
      const isSel = selectedIds.has(i);

      ctx.fillStyle = isSel ? paintColor
        : (px && px.color !== 0) ? numToHex(px.color)
        : UNOWNED_COLOR;
      ctx.fillRect(x, y, ps, ps);

      if (ps >= 5) {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x + 0.25, y + 0.25, ps - 0.5, ps - 0.5);
      }

      if (isSel) {
        const lw = Math.max(1.5, ps * 0.09);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = lw;
        ctx.strokeRect(x + lw / 2, y + lw / 2, ps - lw, ps - lw);
      }
    }
  }, [pixels, selectedIds, paintColor, getPs]);

  useEffect(() => { draw(); }, [draw]);

  // ─── convert screen coords → pixel id ─────────────────────────────
  const hitTest = useCallback((clientX: number, clientY: number): number => {
    const cont = containerRef.current;
    if (!cont) return -1;
    const rect = cont.getBoundingClientRect();
    const ps   = getPs();
    // subtract container origin AND current pan offset
    const lx = clientX - rect.left - panRef.current.x;
    const ly = clientY - rect.top  - panRef.current.y;
    const col = Math.floor(lx / ps);
    const row = Math.floor(ly / ps);
    if (col < 0 || col >= GRID || row < 0 || row >= GRID) return -1;
    return row * GRID + col;
  }, [getPs]);

  // ─── Mouse events ─────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStart.current = { x: e.clientX, y: e.clientY };
    dragMoved.current = false;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (!dragMoved.current && Math.abs(dx) + Math.abs(dy) > 4) {
      dragMoved.current = true;
    }
    if (dragMoved.current) {
      dragStart.current = { x: e.clientX, y: e.clientY };
      applyPan(panRef.current.x + dx, panRef.current.y + dy, zoom);
    }
  }, [applyPan, zoom]);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current) return;
    if (!dragMoved.current) {
      const id = hitTest(e.clientX, e.clientY);
      if (id >= 0) onSelect(id);
    }
    dragStart.current = null;
    dragMoved.current = false;
  }, [hitTest, onSelect]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setZoom(z => {
      const nz = Math.min(12, Math.max(0.5, z * factor));
      applyPan(panRef.current.x, panRef.current.y, nz);
      return nz;
    });
  }, [applyPan]);

  // ─── Touch events ─────────────────────────────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      dragMoved.current = false;
      pinchDist.current = null;
    } else if (e.touches.length === 2) {
      dragStart.current = null;
      const t0 = e.touches[0], t1 = e.touches[1];
      pinchDist.current = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    }
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && dragStart.current) {
      const dx = e.touches[0].clientX - dragStart.current.x;
      const dy = e.touches[0].clientY - dragStart.current.y;
      if (!dragMoved.current && Math.abs(dx) + Math.abs(dy) > 6) dragMoved.current = true;
      if (dragMoved.current) {
        dragStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        applyPan(panRef.current.x + dx, panRef.current.y + dy, zoom);
      }
    } else if (e.touches.length === 2 && pinchDist.current !== null) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist  = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const scale = dist / pinchDist.current;
      pinchDist.current = dist;
      setZoom(z => {
        const nz = Math.min(12, Math.max(0.5, z * scale));
        applyPan(panRef.current.x, panRef.current.y, nz);
        return nz;
      });
    }
  }, [applyPan, zoom]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0 && dragStart.current && !dragMoved.current) {
      const t = e.changedTouches[0];
      const id = hitTest(t.clientX, t.clientY);
      if (id >= 0) onSelect(id);
    }
    if (e.touches.length === 0) { dragStart.current = null; dragMoved.current = false; }
    if (e.touches.length < 2) pinchDist.current = null;
  }, [hitTest, onSelect]);

  // ─── Zoom buttons ─────────────────────────────────────────────────
  const zoomIn    = useCallback(() => setZoom(z => { const nz = Math.min(12, z * 1.5); applyPan(panRef.current.x, panRef.current.y, nz); return nz; }), [applyPan]);
  const zoomOut   = useCallback(() => setZoom(z => { const nz = Math.max(0.5, z / 1.5); applyPan(panRef.current.x, panRef.current.y, nz); return nz; }), [applyPan]);
  const zoomReset = useCallback(() => { setZoom(1); applyPan(0, 0, 1); }, [applyPan]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden scanlines"
      style={{ background: '#0a0f1f', touchAction: 'none', userSelect: 'none' }}
    >
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-20">
          <div
            className="w-10 h-10 rounded-xl pixel-bounce"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--pixel-blue))', boxShadow: '0 0 20px var(--accent-glow)' }}
          />
          <span className="text-sm" style={{ color: 'var(--muted)' }}>Loading canvas…</span>
        </div>
      )}

      {/* Canvas positioned by pan */}
      <div
        style={{ position: 'absolute', left: panState.x, top: panState.y, cursor: 'crosshair' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <canvas ref={canvasRef} style={{ imageRendering: 'pixelated', display: 'block' }} />
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10" style={{ pointerEvents: 'auto' }}>
        <ZoomBtn label="＋" onClick={zoomIn} />
        <ZoomBtn label="－" onClick={zoomOut} />
        <ZoomBtn label="↺" onClick={zoomReset} />
      </div>

      {/* Status badge */}
      <div
        className="absolute bottom-3 left-3 text-xs px-2.5 py-1 rounded-lg z-10"
        style={{ background: 'var(--glass)', border: '1px solid var(--border)', color: 'var(--muted)', backdropFilter: 'blur(8px)' }}
      >
        {selectedIds.size > 0
          ? <span style={{ color: 'var(--accent-2)' }}>{selectedIds.size} pixel{selectedIds.size > 1 ? 's' : ''} selected</span>
          : '100×100 · tap to paint'}
      </div>
    </div>
  );
}
