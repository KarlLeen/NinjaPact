import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi'
import { formatUnits, parseUnits, type Address } from 'viem'
import { MOCK_USD_ABI, MOCK_USD_ADDRESS } from '../lib/contracts'
import { useToast } from '../lib/toast'

export const FAUCET_MUSD = parseUnits('10000', 6)

/// Testnet faucet: MockUSD.mint is permissionless — mint 10000 mUSD to the connected wallet.
export function MintMusdButton({ block = false }: { block?: boolean }) {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const publicClient = usePublicClient()
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
    if (!address || !publicClient) return
    setMinting(true)
    try {
      toast('领取测试 mUSD...', 'info')
      const hash = await writeContractAsync({
        abi: MOCK_USD_ABI,
        address: MOCK_USD_ADDRESS,
        functionName: 'mint',
        args: [address as Address, FAUCET_MUSD],
      })
      await publicClient.waitForTransactionReceipt({ hash })
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

  return (
    <div style={{ marginBottom: block ? 16 : 0 }}>
      {balance !== undefined && (
        <div className="label" style={{ marginBottom: 8, textAlign: block ? 'center' : 'left' }}>
          测试币余额：{formatUnits(balance, 6)} mUSD
        </div>
      )}
      <button
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
