import { useEffect, useRef } from 'react';
import { ConnectKitButton } from 'connectkit';

// Mini animated pixel grid preview
function MiniCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const COLS = 20, ROWS = 14, PS = 18;
    c.width  = COLS * PS;
    c.height = ROWS * PS;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const canvas = c; // non-null alias for closure
    const COLORS = [
      '#ff4d6d','#ff8c42','#ffd166','#06d6a0','#4cc9f0',
      '#7c6aff','#b14aed','#f72585','#3a0ca3','#560bad',
      '#4361ee','#4cc9f0','#0d1b2f','#1f2f44','#2d3a5a',
    ];
    const grid = Array.from({ length: COLS * ROWS }, () =>
      Math.random() < 0.55 ? COLORS[Math.floor(Math.random() * COLORS.length)] : '#12183a'
    );
    let frame = 0;
    let raf = 0;
    function tick() {
      frame++;
      // randomly repaint a pixel every few frames
      if (frame % 6 === 0) {
        const idx = Math.floor(Math.random() * grid.length);
        grid[idx] = Math.random() < 0.6
          ? COLORS[Math.floor(Math.random() * COLORS.length)]
          : '#12183a';
      }
      // ctx is guaranteed non-null (checked above); TS loses narrowing in closures
      const gctx = ctx as CanvasRenderingContext2D;
      gctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < grid.length; i++) {
        const x = (i % COLS) * PS, y = Math.floor(i / COLS) * PS;
        gctx.fillStyle = grid[i];
        gctx.fillRect(x, y, PS - 1, PS - 1);
      }
      raf = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <canvas
      ref={ref}
      style={{ imageRendering: 'pixelated', borderRadius: 8, opacity: 0.92 }}
      className="block w-full"
    />
  );
}

const STEPS = [
  {
    emoji: '🔗',
    color: 'var(--pixel-blue)',
    title: 'Connect your wallet',
    desc: 'Use MetaMask, Coinbase Wallet, or any browser wallet. The game will ask you to switch to Arc Testnet — just approve it.',
  },
  {
    emoji: '🎨',
    color: 'var(--pixel-purple)',
    title: 'Pick a color & tap any pixel',
    desc: 'Choose your favorite color from the palette. Tap (mobile) or click (desktop) pixels on the 100×100 canvas to select them. You can pick multiple at once.',
  },
  {
    emoji: '💸',
    color: 'var(--pixel-yellow)',
    title: 'Approve & Paint',
    desc: 'Each unclaimed pixel costs 0.05 USDC. Tap "Approve" once, then "Paint" to own it. Already owned? Pay 2× to steal it — the previous owner earns the difference.',
  },
  {
    emoji: '🏆',
    color: 'var(--pixel-green)',
    title: 'Own the most pixels to win',
    desc: 'You play at your own pace — paint whenever you like, steal rivals\' pixels to build territory. The player owning the most pixels when the season ends wins 50% of the prize pool.',
  },
  {
    emoji: '💰',
    color: 'var(--pixel-orange)',
    title: 'Claim your earnings',
    desc: 'Every time someone steals your pixel, you earn half the price. Prize winnings also accumulate here. Tap "Claim Earnings" any time to withdraw USDC to your wallet.',
  },
];

interface Props {
  onEnter: () => void;
}

export function LandingPage({ onEnter }: Props) {
  return (
    <div
      className="min-h-dvh flex flex-col"
      style={{ background: 'var(--bg-gradient)' }}
    >
      {/* Nav */}
      <nav className="flex items-center justify-between px-5 py-4 shrink-0">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 22 }}>🎮</span>
          <span className="display font-bold text-lg" style={{ color: 'var(--ink)' }}>
            Pixel<span style={{ color: 'var(--accent)' }}>War</span>
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'rgba(124,106,255,0.18)', color: 'var(--accent-2)', border: '1px solid rgba(124,106,255,0.3)' }}
          >
            Testnet
          </span>
        </div>
        <ConnectKitButton />
      </nav>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-5 pt-8 pb-6 gap-6">
        {/* Live pixel preview */}
        <div
          className="w-full max-w-sm rounded-2xl overflow-hidden pixel-border glow-accent fade-in"
          style={{ background: '#0d1228' }}
        >
          <MiniCanvas />
        </div>

        <div className="fade-in-delay-1">
          <h1
            className="display font-bold text-4xl sm:text-5xl mb-3 glow-text"
            style={{ color: 'var(--ink)', lineHeight: 1.1 }}
          >
            Paint the<br />
            <span style={{
              background: 'linear-gradient(90deg, var(--accent), var(--pixel-blue), var(--pixel-green))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>blockchain</span>
          </h1>
          <p className="text-base max-w-sm mx-auto" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
            A shared 100×100 canvas where every pixel costs USDC to own.
            Play solo or compete — whoever holds the most pixels at season end splits the prize pool.
          </p>
        </div>

        {/* Stats row */}
        <div className="flex gap-4 fade-in-delay-2">
          {[
            { label: '10,000 pixels', sub: 'on-chain canvas' },
            { label: '0.05 USDC', sub: 'per pixel' },
            { label: '50/30/20%', sub: 'prize split' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="display font-bold text-sm sm:text-base" style={{ color: 'var(--accent-2)' }}>{s.label}</div>
              <div className="text-xs" style={{ color: 'var(--subtle)' }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex flex-col gap-3 w-full max-w-xs fade-in-delay-3">
          <button
            onClick={onEnter}
            className="btn-primary w-full py-4 text-base flex items-center justify-center gap-2"
          >
            <span>🎨</span> Start Painting
          </button>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            Free to play on Arc Testnet · No ETH needed
          </p>
        </div>
      </section>

      {/* How to play */}
      <section className="px-5 pb-10">
        <div className="max-w-lg mx-auto">
          <h2
            className="display font-bold text-2xl text-center mb-6"
            style={{ color: 'var(--ink)' }}
          >
            How to Play
          </h2>

          <div className="flex flex-col gap-3">
            {STEPS.map((step, i) => (
              <div
                key={i}
                className="flex items-start gap-4 rounded-2xl p-4"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              >
                <div
                  className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                  style={{ background: 'rgba(255,255,255,0.07)', border: `2px solid ${step.color}33` }}
                >
                  {step.emoji}
                </div>
                <div>
                  <div
                    className="font-semibold text-sm mb-0.5"
                    style={{ color: step.color }}
                  >
                    {i + 1}. {step.title}
                  </div>
                  <div className="text-sm" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
                    {step.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Solo play callout */}
          <div
            className="mt-6 rounded-2xl p-4 flex items-start gap-3"
            style={{ background: 'rgba(6,214,160,0.08)', border: '1px solid rgba(6,214,160,0.25)' }}
          >
            <span style={{ fontSize: 22 }}>🙋</span>
            <div>
              <div className="font-bold text-sm mb-1" style={{ color: 'var(--success)' }}>Can I play alone?</div>
              <div className="text-sm" style={{ color: 'var(--muted)', lineHeight: 1.5 }}>
                Yes! You don't need anyone else to start. Paint any unclaimed pixel for 0.05 USDC, build your territory, and earn when others try to steal it. The more pixels you hold at season end, the bigger your prize share. No bots, no waiting — just you vs. the canvas.
              </div>
            </div>
          </div>

          {/* Game rules card */}
          <div
            className="mt-4 rounded-2xl p-5"
            style={{ background: 'linear-gradient(135deg, rgba(124,106,255,0.12), rgba(76,201,240,0.08))', border: '1px solid var(--border-2)' }}
          >
            <div className="display font-bold text-base mb-3" style={{ color: 'var(--accent-2)' }}>
              The Rules
            </div>
            <ul className="space-y-2 text-sm" style={{ color: 'var(--muted)' }}>
              <li className="flex items-start gap-2">
                <span style={{ color: 'var(--pixel-red)' }}>◆</span>
                Unclaimed pixels cost <strong style={{ color: 'var(--ink)' }}>0.05 USDC</strong> each.
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: 'var(--pixel-orange)' }}>◆</span>
                Stealing a pixel costs <strong style={{ color: 'var(--ink)' }}>2× its current price</strong>.
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: 'var(--pixel-yellow)' }}>◆</span>
                When stolen: <strong style={{ color: 'var(--ink)' }}>half</strong> goes to the prize pool, <strong style={{ color: 'var(--ink)' }}>half</strong> to the previous owner.
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: 'var(--pixel-green)' }}>◆</span>
                Most pixels at season end wins the <strong style={{ color: 'var(--ink)' }}>prize pool</strong>.
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: 'var(--pixel-blue)' }}>◆</span>
                Claim earnings <strong style={{ color: 'var(--ink)' }}>any time</strong> — no waiting for season end.
              </li>
            </ul>
          </div>

          <button
            onClick={onEnter}
            className="btn-primary w-full py-4 text-base mt-6 flex items-center justify-center gap-2"
          >
            <span>🚀</span> Play Now — It's Free
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center pb-6 text-xs" style={{ color: 'var(--subtle)' }}>
        Built with Arc Studio · Powered by USDC on Arc Testnet
      </footer>
    </div>
  );
}
