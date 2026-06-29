import { useState } from 'react'
import { useAccount, useWriteContract, usePublicClient } from 'wagmi'
import { REPUTATION_ABI, REPUTATION_REGISTRY_ADDRESS } from '../lib/contracts'
import { JUDGE_AGENT_ID_BN, feedbackArgs, hasRated, markRated, type Scene, type Outcome } from '../lib/reputation'
import { useToast } from '../lib/toast'

// Post-conclusion card: the user rates the Judge agent (ERC-8004) on whether the
// verdict was fair. Writes giveFeedback() from the user's own wallet (Model A).
export function RateJudge({ id, scene, outcome }: { id: bigint; scene: Scene; outcome: Outcome }) {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
  const toast = useToast()

  const [rated, setRated] = useState(() => hasRated(id))
  const [busy, setBusy] = useState(false)

  // Hidden when the Judge agent isn't configured or no wallet is connected.
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
      await publicClient!.waitForTransactionReceipt({ hash })
      markRated(id)
      setRated(true)
      toast('感谢评价，已上链 ', 'success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('rejected') ? '已取消' : `失败：${msg.slice(0, 50)}`, 'error')
    } finally { setBusy(false) }
  }

  if (rated) {
    return (
      <div className="card" style={{ marginTop: 16, textAlign: 'center' }}>
        <p className="subtitle" style={{ fontSize: 13 }}>已评价 Judge 的裁决，感谢！口碑已记入 ERC-8004。</p>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>⚖️ 给裁判打分</div>
      <p className="label" style={{ marginBottom: 14 }}>
        本次裁决是否公正?评价将作为口碑写入 Judge 的 ERC-8004 链上声誉(与你自己的成败无关)。
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => rate(true)} disabled={busy}>
          {busy ? <span className="spinner" /> : '公正'}
        </button>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => rate(false)} disabled={busy}>
          不满意
        </button>
      </div>
    </div>
  )
}
