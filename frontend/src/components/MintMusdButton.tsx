import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract } from 'wagmi'
import { formatUnits, parseUnits, type Address } from 'viem'
import { MOCK_USD_ABI, MOCK_USD_ADDRESS } from '../lib/contracts'
import { useToast } from '../lib/toast'
import { waitReceipt } from '../lib/tx'

export const FAUCET_MUSD = parseUnits('10000', 6)

/// Testnet faucet: MockUSD.mint is permissionless — mint 10000 mUSD to the connected wallet.
export function MintMusdButton({ block = false, compact = false }: { block?: boolean; compact?: boolean }) {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const toast = useToast()
  const [minting, setMinting] = useState(false)

  const { data: balance, refetch } = useReadContract({
    abi: MOCK_USD_ABI,
    address: MOCK_USD_ADDRESS,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!MOCK_USD_ADDRESS },
  })

  async function handleMint() {
    if (!address) return
    setMinting(true)
    try {
      toast('领取测试 mUSD...', 'info')
      const hash = await writeContractAsync({
        abi: MOCK_USD_ABI,
        address: MOCK_USD_ADDRESS,
        functionName: 'mint',
        args: [address as Address, FAUCET_MUSD],
      })
      await waitReceipt(hash)
      await refetch()
      toast('已领取 10000 mUSD', 'success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast(msg.includes('rejected') ? '已取消' : `领取失败：${msg.slice(0, 50)}`, 'error')
    } finally {
      setMinting(false)
    }
  }

  if (!MOCK_USD_ADDRESS) return null

  if (compact) {
    return (
      <button
        type="button"
        className="btn btn-ghost btn-sm mint-toolbar-btn"
        onClick={handleMint}
        disabled={minting || !address}
        title={balance !== undefined ? `余额 ${formatUnits(balance, 6)} mUSD` : undefined}
      >
        {minting ? <><span className="spinner" /> 领取中...</> : '领取测试 mUSD（10000）'}
      </button>
    )
  }

  return (
    <div style={{ marginBottom: block ? 16 : 0 }}>
      {balance !== undefined && (
        <div className="label" style={{ marginBottom: 8, textAlign: block ? 'center' : 'left' }}>
          测试币余额：{formatUnits(balance, 6)} mUSD
        </div>
      )}
      <button
        type="button"
        className={`btn btn-ghost${block ? ' btn-block' : ''}`}
        onClick={handleMint}
        disabled={minting || !address}
        style={block ? undefined : { padding: '8px 14px', fontSize: 13 }}
      >
        {minting ? <><span className="spinner" /> 领取中...</> : '领取测试 mUSD（10000）'}
      </button>
    </div>
  )
}
