import { useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { erc20Abi } from 'viem';
import { toast } from 'sonner';
import { Paintbrush, X, ExternalLink, Zap } from 'lucide-react';
import { PIXEL_WAR_ADDRESS, PIXEL_WAR_ABI, USDC_ADDRESS, PIXEL_WAR_CHAIN_ID, EXPLORER_BASE } from '@/abi';
import { Amount } from '@/onchain-money';
import type { PixelData } from './PixelCanvas';

function fmt(raw: bigint, dp = 2) {
  return Amount.fromRaw(raw, 6).toFixed(dp);
}

const PALETTE = [
  '#ff4d6d','#ff8c42','#ffd166','#06d6a0','#4cc9f0',
  '#7c6aff','#b14aed','#f72585','#3a86ff','#38b000',
  '#ffffff','#c8d4f0','#8899bb','#2d3a5a','#0a0e1a',
  '#ff6b35','#e63946','#118ab2','#06d6a0','#ffd166',
];

interface Props {
  selectedIds: Set<number>;
  pixels: (PixelData | null)[];
  paintColor: string;
  onColorChange: (c: string) => void;
  onClearSelection: () => void;
  onPaintSuccess: () => void;
}

function hexToUint24(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function formatAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function PaintSidebar({ selectedIds, pixels, paintColor, onColorChange, onClearSelection, onPaintSuccess }: Props) {
  const { address, chainId } = useAccount();
  const ids = Array.from(selectedIds);
  const count = ids.length;

  // Derive customColor from paintColor — no effect needed, just keep in sync via state init
  // We set it directly when a palette button is clicked; the input also sets both.

  const totalCost = ids.reduce((sum, id) => {
    const px = pixels[id];
    const price = px ? px.price : 50000n;
    return sum + price;
  }, 0n);

  const isOnRightChain = chainId === PIXEL_WAR_CHAIN_ID;

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, PIXEL_WAR_ADDRESS] : undefined,
    chainId: PIXEL_WAR_CHAIN_ID,
    query: { enabled: !!address },
  });

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: PIXEL_WAR_CHAIN_ID,
    query: { enabled: !!address },
  });

  // Approve
  const { writeContract: approve, data: approveTxHash, isPending: isApproving } = useWriteContract();
  const { isLoading: isApproveConfirming, isSuccess: isApproved } = useWaitForTransactionReceipt({ hash: approveTxHash });
  useEffect(() => {
    if (isApproved) { void refetchAllowance(); }
  }, [isApproved, refetchAllowance]);

  // Paint
  const { writeContract: paint, data: paintTxHash, isPending: isPainting } = useWriteContract();
  const { isLoading: isPaintConfirming, isSuccess: isPainted } = useWaitForTransactionReceipt({ hash: paintTxHash });
  useEffect(() => {
    if (isPainted) { toast.success('Pixels painted!'); onPaintSuccess(); }
  }, [isPainted, onPaintSuccess]);

  const needsApproval = allowance !== undefined && allowance < totalCost;
  const hasFunds = usdcBalance !== undefined && usdcBalance >= totalCost;

  const handleApprove = () => {
    if (!isOnRightChain || !address) return;
    approve({
      address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve',
      args: [PIXEL_WAR_ADDRESS, totalCost * 10n], // approve 10× so user doesn't approve every tx
      chainId: PIXEL_WAR_CHAIN_ID,
    });
  };

  const handlePaint = () => {
    if (!isOnRightChain || !address || count === 0) return;
    const colorValue = hexToUint24(paintColor);
    paint({
      address: PIXEL_WAR_ADDRESS, abi: PIXEL_WAR_ABI, functionName: 'paintPixels',
      args: [ids.map(BigInt), ids.map(() => colorValue), totalCost],
      chainId: PIXEL_WAR_CHAIN_ID,
    });
  };

  const costDisplay = fmt(totalCost, 4);
  const balDisplay = usdcBalance !== undefined ? fmt(usdcBalance, 2) : '—';

  return (
    <div className="flex flex-col gap-5">

      {/* ── Color palette ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
            Choose Color
          </span>
          <div
            className="flex items-center gap-2 px-2.5 py-1 rounded-lg"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <div className="w-4 h-4 rounded-sm" style={{ background: paintColor }} />
            <span className="mono text-xs" style={{ color: 'var(--muted)' }}>{paintColor}</span>
          </div>
        </div>

        <div className="grid grid-cols-10 gap-1.5 mb-3">
          {PALETTE.map(c => (
            <button
              key={c}
              onClick={() => onColorChange(c)}
              className="aspect-square rounded-md transition-transform active:scale-90"
              style={{
                background: c,
                outline: paintColor === c ? '2.5px solid var(--accent-2)' : '2px solid transparent',
                outlineOffset: '2px',
                minHeight: 28,
                boxShadow: paintColor === c ? `0 0 8px ${c}88` : 'none',
              }}
            />
          ))}
        </div>

        <label
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          <div className="relative w-8 h-8 rounded-lg overflow-hidden">
            <div className="absolute inset-0 rounded-lg" style={{ background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' }} />
            <input
              type="color"
              value={paintColor}
              onChange={e => onColorChange(e.target.value)}
              className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            />
          </div>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>Custom color</span>
        </label>
      </div>

      {/* ── Selection summary ──────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
            Selection
          </span>
          {count > 0 && (
            <button
              onClick={onClearSelection}
              className="flex items-center gap-1 text-xs rounded-lg px-2 py-1"
              style={{ color: 'var(--danger)', background: 'rgba(255,77,109,0.1)' }}
            >
              <X size={11} /> Clear all
            </button>
          )}
        </div>

        {count === 0 ? (
          <div
            className="rounded-xl p-4 text-center"
            style={{ background: 'var(--surface)', border: '1px dashed var(--border-2)' }}
          >
            <div className="text-2xl mb-1">👆</div>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Tap pixels on the canvas to select them
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--subtle)' }}>
              You can select multiple pixels at once
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border-2)' }}
          >
            <div
              className="px-4 py-3 flex justify-between items-center"
              style={{ background: 'var(--surface-3)' }}
            >
              <span className="font-semibold text-sm">
                {count} pixel{count > 1 ? 's' : ''} selected
              </span>
              <div
                className="w-5 h-5 rounded"
                style={{ background: paintColor, boxShadow: `0 0 8px ${paintColor}99` }}
              />
            </div>
            <div className="px-4 py-3 space-y-2 text-sm" style={{ background: 'var(--surface-2)' }}>
              <div className="flex justify-between">
                <span style={{ color: 'var(--muted)' }}>Total cost</span>
                <span className="font-bold tabular-nums" style={{ color: 'var(--accent-2)' }}>
                  {costDisplay} USDC
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--muted)' }}>Your balance</span>
                <span
                  className="tabular-nums font-medium"
                  style={{ color: hasFunds ? 'var(--success)' : 'var(--danger)' }}
                >
                  {balDisplay} USDC
                </span>
              </div>
              {!hasFunds && address && (
                <p className="text-xs" style={{ color: 'var(--danger)' }}>
                  Not enough USDC. Get testnet USDC from the sidebar.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Single pixel info ──────────────────────────────────── */}
      {count === 1 && (() => {
        const px = pixels[ids[0]];
        const zero = '0x0000000000000000000000000000000000000000';
        if (!px || px.owner === zero) return null;
        return (
          <div
            className="rounded-xl p-3 text-xs space-y-2"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="font-semibold text-sm mb-1" style={{ color: 'var(--ink-2)' }}>
              Pixel #{ids[0]} is owned
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted)' }}>Owner</span>
              <span className="mono" style={{ color: 'var(--accent-2)' }}>{formatAddr(px.owner)}</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted)' }}>Current price</span>
              <span className="tabular-nums">{fmt(px.price, 4)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted)' }}>Steal cost</span>
              <span className="tabular-nums font-bold" style={{ color: 'var(--pixel-red)' }}>
                {fmt(px.price * 2n, 4)} USDC
              </span>
            </div>
          </div>
        );
      })()}

      {/* ── Action button ──────────────────────────────────────── */}
      <div className="space-y-2">
        {!address ? (
          <div
            className="rounded-xl p-4 text-center text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="text-2xl mb-2">👛</div>
            <p style={{ color: 'var(--muted)' }}>Connect your wallet to start painting</p>
          </div>
        ) : !isOnRightChain ? (
          <div className="text-sm text-center py-2" style={{ color: 'var(--danger)' }}>
            Switch to Arc Testnet first
          </div>
        ) : count === 0 ? null : needsApproval ? (
          <button
            onClick={handleApprove}
            disabled={isApproving || isApproveConfirming}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            <Zap size={16} />
            {isApproving ? 'Confirm in wallet…' : isApproveConfirming ? 'Approving USDC…' : `Approve USDC`}
          </button>
        ) : (
          <button
            onClick={handlePaint}
            disabled={isPainting || isPaintConfirming || !hasFunds}
            className="btn-primary w-full py-4 flex items-center justify-center gap-2"
          >
            <Paintbrush size={16} />
            {isPainting ? 'Confirm in wallet…'
              : isPaintConfirming ? 'Painting…'
              : `Paint ${count} pixel${count > 1 ? 's' : ''} · ${costDisplay} USDC`}
          </button>
        )}

        {paintTxHash && (
          <a
            href={`${EXPLORER_BASE}/tx/${paintTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-xs"
            style={{ color: 'var(--accent-2)' }}
          >
            <ExternalLink size={11} /> View on explorer
          </a>
        )}
      </div>
    </div>
  );
}
