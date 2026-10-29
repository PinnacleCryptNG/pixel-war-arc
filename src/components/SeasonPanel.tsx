import { useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { Trophy, Clock, Coins, ExternalLink, Users } from 'lucide-react';
import { PIXEL_WAR_ADDRESS, PIXEL_WAR_ABI, PIXEL_WAR_CHAIN_ID, EXPLORER_BASE } from '@/abi';
import { Amount } from '@/onchain-money';

function fmt(raw: bigint, dp = 2) {
  return Amount.fromRaw(raw, 6).toFixed(dp);
}

function useCountdown(endTime: bigint | undefined) {
  const now = Math.floor(Date.now() / 1000);
  if (!endTime) return { label: '—', over: false };
  const diff = Number(endTime) - now;
  if (diff <= 0) return { label: 'Season ended!', over: true };
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (d > 0) return { label: `${d}d ${h}h left`, over: false };
  if (h > 0) return { label: `${h}h ${m}m left`, over: false };
  return { label: `${m}m ${s}s left`, over: false };
}

interface Props { onRefresh: () => void; }

export function SeasonPanel({ onRefresh }: Props) {
  const { address, chainId } = useAccount();
  const isOnRightChain = chainId === PIXEL_WAR_CHAIN_ID;

  const { data: season } = useReadContract({
    address: PIXEL_WAR_ADDRESS, abi: PIXEL_WAR_ABI, functionName: 'getSeason',
    chainId: PIXEL_WAR_CHAIN_ID, query: { refetchInterval: 15_000 },
  });
  const { data: pendingRaw, refetch: refetchPending } = useReadContract({
    address: PIXEL_WAR_ADDRESS, abi: PIXEL_WAR_ABI, functionName: 'getPendingWithdrawal',
    args: address ? [address] : undefined,
    chainId: PIXEL_WAR_CHAIN_ID, query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const { data: pixelCount } = useReadContract({
    address: PIXEL_WAR_ADDRESS, abi: PIXEL_WAR_ABI, functionName: 'getPixelCount',
    args: address ? [address] : undefined,
    chainId: PIXEL_WAR_CHAIN_ID, query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const { data: totalOwners } = useReadContract({
    address: PIXEL_WAR_ADDRESS, abi: PIXEL_WAR_ABI, functionName: 'getAllOwnersCount',
    chainId: PIXEL_WAR_CHAIN_ID, query: { refetchInterval: 30_000 },
  });

  const { writeContract: claimFn, data: claimHash, isPending: isClaiming } = useWriteContract();
  const { isLoading: isClaimConfirming, isSuccess: isClaimed } = useWaitForTransactionReceipt({ hash: claimHash });
  useEffect(() => {
    if (isClaimed) { void refetchPending(); onRefresh(); }
  }, [isClaimed, refetchPending, onRefresh]);

  const { writeContract: endSeasonFn, data: endHash, isPending: isEnding } = useWriteContract();
  const { isLoading: isEndConfirming, isSuccess: isEnded } = useWaitForTransactionReceipt({ hash: endHash });
  useEffect(() => {
    if (isEnded) { onRefresh(); }
  }, [isEnded, onRefresh]);

  const countdown = useCountdown(season?.[0]);
  const prizePool  = season?.[1] ?? 0n;
  const active     = season?.[2] ?? false;
  const pending    = pendingRaw ?? 0n;
  const hasPending = pending > 0n;

  const handleClaim = () => {
    if (!isOnRightChain || !address) return;
    claimFn({ address: PIXEL_WAR_ADDRESS, abi: PIXEL_WAR_ABI, functionName: 'claimEarnings', chainId: PIXEL_WAR_CHAIN_ID });
  };
  const handleEndSeason = () => {
    if (!isOnRightChain) return;
    endSeasonFn({ address: PIXEL_WAR_ADDRESS, abi: PIXEL_WAR_ABI, functionName: 'endSeason', chainId: PIXEL_WAR_CHAIN_ID });
  };

  return (
    <div className="flex flex-col gap-4">

      {/* ── Season status card ─────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid var(--border-2)' }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, rgba(124,106,255,0.25), rgba(76,201,240,0.12))' }}
        >
          <div className="flex items-center gap-2">
            <Trophy size={16} style={{ color: 'var(--pixel-yellow)' }} />
            <span className="display font-bold text-sm">Season 1</span>
          </div>
          <span
            className="text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{
              background: active ? 'rgba(6,214,160,0.18)' : 'rgba(255,77,109,0.18)',
              color: active ? 'var(--success)' : 'var(--danger)',
              border: `1px solid ${active ? 'rgba(6,214,160,0.35)' : 'rgba(255,77,109,0.35)'}`,
            }}
          >
            {active ? '● Live' : '○ Ended'}
          </span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-px" style={{ background: 'var(--border)' }}>
          {[
            { icon: <Coins size={14} />, label: 'Prize Pool', value: `${fmt(prizePool, 2)} USDC`, color: 'var(--pixel-yellow)' },
            { icon: <Clock size={14} />, label: 'Time Left', value: countdown.label, color: countdown.over ? 'var(--danger)' : 'var(--accent-2)' },
            { icon: <Users size={14} />, label: 'Painters', value: totalOwners !== undefined ? totalOwners.toString() : '—', color: 'var(--pixel-green)' },
            { icon: <Trophy size={14} />, label: 'Your pixels', value: pixelCount !== undefined ? pixelCount.toString() : address ? '—' : 'Connect', color: 'var(--pixel-blue)' },
          ].map(s => (
            <div
              key={s.label}
              className="px-4 py-3"
              style={{ background: 'var(--surface-2)' }}
            >
              <div className="flex items-center gap-1 mb-1" style={{ color: 'var(--subtle)' }}>
                {s.icon}
                <span className="text-xs">{s.label}</span>
              </div>
              <div className="display font-bold text-base tabular-nums" style={{ color: s.color }}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* End season button */}
        {countdown.over && active && (
          <div className="px-4 py-3" style={{ background: 'var(--surface-2)' }}>
            <button
              onClick={handleEndSeason}
              disabled={isEnding || isEndConfirming || !isOnRightChain}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-sm"
            >
              <Trophy size={15} />
              {isEnding ? 'Confirm in wallet…' : isEndConfirming ? 'Ending season…' : 'End Season & Share Prizes'}
            </button>
          </div>
        )}
        {endHash && (
          <div className="px-4 pb-3">
            <a
              href={`${EXPLORER_BASE}/tx/${endHash}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs justify-center"
              style={{ color: 'var(--accent-2)' }}
            >
              <ExternalLink size={11} /> View transaction
            </a>
          </div>
        )}
      </div>

      {/* ── Prize split info ───────────────────────────────────── */}
      <div
        className="rounded-2xl p-4"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--subtle)' }}>
          Prize Distribution
        </div>
        {[
          { rank: '🥇 1st', pct: '50%', color: 'var(--pixel-yellow)' },
          { rank: '🥈 2nd', pct: '30%', color: 'var(--muted)' },
          { rank: '🥉 3rd', pct: '20%', color: 'var(--pixel-orange)' },
        ].map(r => (
          <div key={r.rank} className="flex items-center gap-3 mb-2">
            <span className="text-sm w-14">{r.rank}</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: r.pct, background: r.color, boxShadow: `0 0 6px ${r.color}88` }}
              />
            </div>
            <span className="font-bold text-sm tabular-nums" style={{ color: r.color }}>{r.pct}</span>
          </div>
        ))}
        <p className="text-xs mt-3" style={{ color: 'var(--subtle)' }}>
          Based on pixel count at season end. Keep the most pixels to win.
        </p>
      </div>

      {/* ── Your earnings ──────────────────────────────────────── */}
      {address && (
        <div
          className="rounded-2xl p-4"
          style={{ background: 'var(--surface)', border: `1px solid ${hasPending ? 'rgba(6,214,160,0.35)' : 'var(--border)'}` }}
        >
          <div className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--subtle)' }}>
            Your Earnings
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: 'var(--muted)' }}>Claimable</span>
            <span
              className="display font-bold text-xl tabular-nums"
              style={{ color: hasPending ? 'var(--success)' : 'var(--subtle)' }}
            >
              {fmt(pending, 4)} USDC
            </span>
          </div>
          {hasPending && (
            <button
              onClick={handleClaim}
              disabled={isClaiming || isClaimConfirming || !isOnRightChain}
              className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-opacity disabled:opacity-50"
              style={{
                background: 'rgba(6,214,160,0.15)',
                color: 'var(--success)',
                border: '1.5px solid rgba(6,214,160,0.4)',
              }}
            >
              <Coins size={15} />
              {isClaiming ? 'Confirm in wallet…' : isClaimConfirming ? 'Claiming…' : `Claim ${fmt(pending, 4)} USDC`}
            </button>
          )}
          {!hasPending && (
            <p className="text-xs text-center" style={{ color: 'var(--subtle)' }}>
              Paint pixels and steal from others to earn USDC
            </p>
          )}
          {claimHash && (
            <a
              href={`${EXPLORER_BASE}/tx/${claimHash}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs justify-center mt-2"
              style={{ color: 'var(--accent-2)' }}
            >
              <ExternalLink size={11} /> View transaction
            </a>
          )}
        </div>
      )}

      {/* ── How it works ───────────────────────────────────────── */}
      <div
        className="rounded-2xl p-4 space-y-2 text-sm"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}
      >
        <div className="font-bold text-base mb-2" style={{ color: 'var(--ink-2)' }}>Quick Rules</div>
        {[
          ['🎨', 'Unclaimed pixel = 0.05 USDC'],
          ['⚔️', 'Steal a pixel = 2× its price'],
          ['💸', 'Steal: ½ to prize pool, ½ to previous owner'],
          ['🏆', 'Most pixels at end wins 50% of pool'],
          ['💰', 'Claim earnings any time'],
        ].map(([e, t]) => (
          <div key={String(t)} className="flex items-start gap-2">
            <span>{e}</span>
            <span>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
