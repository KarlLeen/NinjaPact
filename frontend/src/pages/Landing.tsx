import { usePrivy } from '@privy-io/react-auth'
import { useNavigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { MintMusdButton } from '../components/MintMusdButton'

function short(a: string) {
  return `${a.slice(0, 6)}...${a.slice(-4)}`
}

export function Landing() {
  const { ready, authenticated, login } = usePrivy()
  const { address } = useAccount()
  const nav = useNavigate()

  return (
    <div className="screen-full" style={{ textAlign: 'center', gap: 0 }}>
      <div className="np-mark" style={{ marginBottom: 16 }} aria-hidden="true">忍</div>
      <h1 className="title" style={{ marginBottom: 12, fontSize: 32 }}>忍者之约</h1>
      <p className="subtitle" style={{ marginBottom: 8, maxWidth: 280 }}>
        用自律立约，用代码守诺
      </p>
      <p className="subtitle" style={{ marginBottom: 32, maxWidth: 280, fontSize: 13 }}>
        质押稳定币 · AI 验收 · 链上结算
      </p>

      {authenticated && address && (
        <p className="label" style={{ marginBottom: 16 }}>{short(address)}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280, width: '100%' }}>
        {authenticated ? (
          <button className="btn btn-primary btn-block" onClick={() => nav('/dashboard')}>
            进入我的承诺 →
          </button>
        ) : (
          <button className="btn btn-primary btn-block" onClick={login} disabled={!ready}>
            {!ready ? <span className="spinner" /> : '开始立约 →'}
          </button>
        )}

        {authenticated ? (
          <MintMusdButton block />
        ) : (
          <button className="btn btn-ghost btn-block" onClick={login} disabled={!ready}>
            登录后领取测试 mUSD
          </button>
        )}
      </div>

      <p className="label" style={{ marginTop: 24 }}>
        {authenticated
          ? '测试网水龙头：每次可领 10000 mUSD 用于质押'
          : '社交登录 · 自动生成钱包 · 无需助记词'}
      </p>
    </div>
  )
}
