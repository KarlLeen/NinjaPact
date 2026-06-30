import { useState } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { REPUTATION_ABI, REPUTATION_REGISTRY_ADDRESS } from '../lib/contracts'
import { JUDGE_AGENT_ID_BN, feedbackArgs, hasRated, markRated, type Scene, type Outcome } from '../lib/reputation'
import { useToast } from '../lib/toast'
import { waitReceipt } from '../lib/tx'

// Post-conclusion card: the user rates the Judge agent (ERC-8004) on whether the
// verdict was fair. Writes giveFeedback() from the user's own wallet (Model A).
export function RateJudge({ id, scene, outcome }: { id: bigint; scene: Scene; outcome: Outcome }) {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const toast = useToast()

  const [rated, setRated] = useState(() => hasRated(id))
  const [busy, setBusy] = useState(false)

  if (JUDGE_AGENT_ID_BN === null || !address) return null

  async function rate(satisfied: boolean) {
    setBusy(true)
    try {
      toast('提交评价上链...', 'info')
      const hash = await writeContractAsync({
        abi: REPUTATION_ABI,
        address: REPUTATION_REGISTRY_ADDRESS,
        functionName: 'giveFeedback',
        args: feedbackArgs({ id, scene, outcome, satisfied }),
      } as Parameters<typeof writeContractAsync>[0])
      await waitReceipt(hash)
      markRated(id)
      setRated(true)
      toast('感谢评价，已上链', 'success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('rejected') ? '已取消' : `失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  if (rated) {
    return (
      <section className="judge-rate-card judge-rate-card--done" aria-live="polite">
        <div className="judge-rate-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="judge-rate-title">已评价 Judge 的裁决</p>
        <p className="subtitle text-dim-sm">口碑已记入 ERC-8004 · Agent #48</p>
      </section>
    )
  }

  return (
    <section className="judge-rate-card" aria-labelledby={`judge-rate-${id}`}>
      <p className="label section-label" id={`judge-rate-${id}`}>给裁判打分</p>
      <p className="judge-rate-lede">
        本次裁决是否公正？评价通过 <code className="mono">giveFeedback</code> 写入 ReputationRegistry，与你自己的成败无关。
      </p>
      <div className="judge-rate-actions">
        <button type="button" className="btn btn-primary" onClick={() => rate(true)} disabled={busy}>
          {busy ? <span className="spinner" /> : '公正'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => rate(false)} disabled={busy}>
          不满意
        </button>
      </div>
    </section>
  )
}
