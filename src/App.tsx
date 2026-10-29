import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount, useSwitchChain, usePublicClient } from 'wagmi';
import { ConnectKitButton } from 'connectkit';
import { Paintbrush, Trophy, RefreshCw, ChevronDown, X, Info } from 'lucide-react';
import { PixelCanvas } from './components/PixelCanvas';
import { PaintSidebar } from './components/PaintSidebar';
import { SeasonPanel } from './components/SeasonPanel';
import { LandingPage } from './components/LandingPage';
import { PIXEL_WAR_ADDRESS, PIXEL_WAR_ABI, PIXEL_WAR_CHAIN_ID } from './abi';
import type { PixelData } from './components/PixelCanvas';

type Sheet = 'paint' | 'season';

// ─── Desktop sidebar ─────────────────────────────────────────────────────────
interface SidebarProps {
  tab: Sheet;
  onTabChange: (t: Sheet) => void;
  selectedIds: Set<number>;
  pixels: (PixelData | null)[];
  paintColor: string;
  onColorChange: (c: string) => void;
  onClearSelection: () => void;
  onPaintSuccess: () => void;
  onRefresh: () => void;
}
function GameSidebar({ tab, onTabChange, selectedIds, pixels, paintColor, onColorChange, onClearSelection, onPaintSuccess, onRefresh }: SidebarProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex gap-1 p-2" style={{ borderBottom: '1px solid var(--border)' }}>
        {([['paint', Paintbrush, 'Paint'] as const, ['season', Trophy, 'Season'] as const]).map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{
              background: tab === id ? 'var(--surface-2)' : 'transparent',
              color: tab === id ? (id === 'paint' ? 'var(--accent-2)' : 'var(--pixel-yellow)') : 'var(--subtle)',
              border: tab === id ? '1px solid var(--border-2)' : '1px solid transparent',
            }}
          >
            <Icon size={14} />{label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'paint' ? (
          <PaintSidebar
            selectedIds={selectedIds} pixels={pixels} paintColor={paintColor}
            onColorChange={onColorChange} onClearSelection={onClearSelection} onPaintSuccess={onPaintSuccess}
          />
        ) : (
          <SeasonPanel onRefresh={onRefresh} />
        )}
      </div>
    </div>
  );
}

const GRID  = 100;
const CHUNK = 200;

export default function App() {
  const { address, chainId } = useAccount();
  const { switchChain }      = useSwitchChain();
  const isWrongChain = !!address && chainId !== PIXEL_WAR_CHAIN_ID;
  const publicClient = usePublicClient({ chainId: PIXEL_WAR_CHAIN_ID });

  const [hasEntered, setHasEntered]       = useState(false);
  const [pixels, setPixels]               = useState<(PixelData | null)[]>(Array(GRID * GRID).fill(null));
  const [loadingPixels, setLoadingPixels] = useState(true);
  const [selectedIds, setSelectedIds]     = useState<Set<number>>(new Set());
  const [paintColor, setPaintColor]       = useState('#7c6aff');
  // mobile sheet state
  const [activeSheet, setActiveSheet]     = useState<Sheet | null>(null);
  // desktop sidebar active tab
  const [sidebarTab, setSidebarTab]       = useState<Sheet>('paint');
  const refreshKey = useRef(0);

  // ─── load pixels ────────────────────────────────────────────────────
  const loadPixels = useCallback(async () => {
    if (!publicClient) return;
    setLoadingPixels(true);
    const total = GRID * GRID;
    const next  = Array<PixelData | null>(total).fill(null);
    try {
      for (let start = 0; start < total; start += CHUNK) {
        const end = Math.min(start + CHUNK, total);
        const ids = Array.from({ length: end - start }, (_, i) => BigInt(start + i));
        const result = await publicClient.readContract({
          address: PIXEL_WAR_ADDRESS,
          abi: PIXEL_WAR_ABI,
          functionName: 'getPixels',
          args: [ids],
        });
        for (let i = 0; i < result.length; i++) {
          next[start + i] = { owner: result[i].owner, color: result[i].color, price: result[i].price };
        }
      }
      setPixels(next);
    } catch (e) {
      console.error('loadPixels error', e);
    } finally {
      setLoadingPixels(false);
    }
  }, [publicClient]);

  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => { void loadPixels(); }, [loadPixels]);

  const handleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    // On mobile: auto-open paint sheet on first tap
    setActiveSheet(s => s === null ? 'paint' : s);
    // On desktop: switch sidebar to paint tab
    setSidebarTab('paint');
  }, []);

  const handlePaintSuccess = useCallback(() => {
    setSelectedIds(new Set());
    setTimeout(() => { void loadPixels(); }, 3000);
  }, [loadPixels]);

  const handleRefresh = useCallback(() => {
    refreshKey.current++;
    void loadPixels();
  }, [loadPixels]);

  if (!hasEntered) {
    return <LandingPage onEnter={() => setHasEntered(true)} />;
  }



  return (
    <div className="flex flex-col" style={{ height: '100dvh', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header
        className="shrink-0 flex items-center justify-between px-4 py-2.5 z-30"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--glass)', backdropFilter: 'blur(16px)' }}
      >
        {/* Logo */}
        <button onClick={() => setHasEntered(false)} className="flex items-center gap-2">
          <span style={{ fontSize: 18 }}>🎮</span>
          <span className="display font-bold text-base" style={{ color: 'var(--ink)' }}>
            Pixel<span style={{ color: 'var(--accent)' }}>War</span>
          </span>
        </button>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {isWrongChain && (
            <button
              onClick={() => switchChain({ chainId: PIXEL_WAR_CHAIN_ID })}
              className="hidden sm:flex text-xs px-3 py-1.5 rounded-lg font-semibold items-center gap-1"
              style={{ background: 'rgba(255,77,109,0.18)', color: 'var(--danger)', border: '1px solid rgba(255,77,109,0.4)' }}
            >
              ⚠ Switch to Arc Testnet
            </button>
          )}
          <button
            onClick={handleRefresh}
            className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center transition-colors"
            style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
            title="Refresh canvas"
          >
            <RefreshCw size={14} />
          </button>
          <ConnectKitButton />
        </div>
      </header>

      {/* ── Wrong chain banner (mobile) ─────────────────────────── */}
      {isWrongChain && (
        <div
          className="sm:hidden shrink-0 flex items-center justify-between px-4 py-2 text-xs"
          style={{ background: 'rgba(255,77,109,0.15)', borderBottom: '1px solid rgba(255,77,109,0.3)', color: 'var(--danger)' }}
        >
          <span>⚠ Wrong network</span>
          <button
            onClick={() => switchChain({ chainId: PIXEL_WAR_CHAIN_ID })}
            className="font-bold underline"
          >
            Switch to Arc Testnet
          </button>
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* Canvas — takes full space on mobile, flex-1 on desktop */}
        <div className="flex-1 relative min-h-0">
          <PixelCanvas
            pixels={pixels}
            selectedIds={selectedIds}
            paintColor={paintColor}
            onSelect={handleSelect}
            loading={loadingPixels}
          />

          {/* Hint pill — only when nothing's happening */}
          {!loadingPixels && selectedIds.size === 0 && !activeSheet && (
            <div
              className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full pointer-events-none z-10"
              style={{ background: 'var(--glass)', border: '1px solid var(--border-2)', color: 'var(--muted)', backdropFilter: 'blur(8px)' }}
            >
              <Info size={11} />
              <span className="hidden sm:inline">Click a pixel · scroll to zoom · drag to pan</span>
              <span className="sm:hidden">Tap a pixel to paint · pinch to zoom</span>
            </div>
          )}
        </div>

        {/* ── Desktop sidebar (hidden on mobile) ──────────────── */}
        <aside
          className="hidden lg:flex flex-col shrink-0"
          style={{ width: 300, borderLeft: '1px solid var(--border)', background: 'var(--bg2)' }}
        >
          <GameSidebar
            tab={sidebarTab} onTabChange={setSidebarTab}
            selectedIds={selectedIds} pixels={pixels} paintColor={paintColor}
            onColorChange={setPaintColor} onClearSelection={() => setSelectedIds(new Set())}
            onPaintSuccess={handlePaintSuccess} onRefresh={handleRefresh}
          />
        </aside>
      </div>

      {/* ── Mobile bottom nav (hidden on desktop) ───────────────── */}
      <nav
        className="lg:hidden shrink-0 flex items-stretch z-30"
        style={{
          borderTop: '1px solid var(--border)',
          background: 'var(--glass)',
          backdropFilter: 'blur(16px)',
          paddingBottom: 'max(4px, env(safe-area-inset-bottom))',
        }}
      >
        <button
          onClick={handleRefresh}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-xs"
          style={{ color: 'var(--subtle)' }}
        >
          <RefreshCw size={18} />
          <span>Refresh</span>
        </button>

        <button
          onClick={() => setActiveSheet(s => s === 'paint' ? null : 'paint')}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-xs relative"
          style={{ color: activeSheet === 'paint' ? 'var(--accent-2)' : 'var(--muted)' }}
        >
          {selectedIds.size > 0 && (
            <span
              className="absolute top-1.5 right-6 w-4 h-4 rounded-full text-xs flex items-center justify-center font-bold leading-none"
              style={{ background: 'var(--accent)', color: '#fff', fontSize: 10 }}
            >
              {selectedIds.size}
            </span>
          )}
          <Paintbrush size={18} />
          <span>Paint</span>
        </button>

        <button
          onClick={() => setActiveSheet(s => s === 'season' ? null : 'season')}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-xs"
          style={{ color: activeSheet === 'season' ? 'var(--pixel-yellow)' : 'var(--muted)' }}
        >
          <Trophy size={18} />
          <span>Season</span>
        </button>
      </nav>

      {/* ── Mobile slide-up sheet ──────────────────────────────── */}
      {activeSheet !== null && (
        <div className="lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
            onClick={() => setActiveSheet(null)}
          />
          {/* Sheet */}
          <div
            className="fixed bottom-0 left-0 right-0 z-50 sheet-enter flex flex-col rounded-t-3xl"
            style={{
              maxHeight: '82dvh',
              background: 'var(--bg2)',
              border: '1px solid var(--border-2)',
              borderBottom: 'none',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            {/* Handle + header */}
            <div className="shrink-0">
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full" style={{ background: 'var(--border-2)' }} />
              </div>
              <div
                className="flex items-center justify-between px-5 pb-3 pt-1"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2.5">
                  {activeSheet === 'paint' ? (
                    <>
                      <Paintbrush size={17} style={{ color: 'var(--accent-2)' }} />
                      <span className="display font-bold">Paint Pixels</span>
                    </>
                  ) : (
                    <>
                      <Trophy size={17} style={{ color: 'var(--pixel-yellow)' }} />
                      <span className="display font-bold">Season & Earnings</span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => setActiveSheet(null)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {activeSheet === 'paint' ? (
                <PaintSidebar
                  selectedIds={selectedIds}
                  pixels={pixels}
                  paintColor={paintColor}
                  onColorChange={setPaintColor}
                  onClearSelection={() => setSelectedIds(new Set())}
                  onPaintSuccess={() => { handlePaintSuccess(); setActiveSheet(null); }}
                />
              ) : (
                <SeasonPanel onRefresh={handleRefresh} />
              )}
            </div>

            {/* Swipe-down affordance */}
            <button
              onClick={() => setActiveSheet(null)}
              className="shrink-0 flex items-center justify-center gap-1 py-2 text-xs"
              style={{ color: 'var(--subtle)' }}
            >
              <ChevronDown size={14} /> Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
