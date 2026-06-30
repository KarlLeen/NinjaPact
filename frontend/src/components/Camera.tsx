import { useRef, useEffect, useState, useCallback } from 'react'

interface CameraProps {
  challenge: string
  onCapture: (dataUrl: string) => void
  onCancel: () => void
  hint?: string        // small label above the instruction (default: 实时验证指令)
  submitLabel?: string // primary button text after capture (default: 提交打卡 →)
}

export function Camera({ challenge, onCapture, onCancel, hint = '实时验证指令', submitLabel = '提交打卡 →' }: CameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [captured, setCaptured] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const startCamera = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setLoading(false)
    } catch {
      setError('无法访问摄像头，请允许摄像头权限')
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    startCamera()
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [startCamera])

  function shoot() {
    const v = videoRef.current
    const c = canvasRef.current
    if (!v || !c) return
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    const dataUrl = c.toDataURL('image/jpeg', 0.72)
    setCaptured(dataUrl)
    streamRef.current?.getTracks().forEach(t => t.stop())
  }

  function handleRetake() {
    setCaptured(null)
    startCamera()
  }

  if (error) return (
    <div className="card" style={{ textAlign: 'center', padding: 32 }}>
      <p style={{ marginBottom: 20, color: 'var(--fail)' }}>{error}</p>
      <button className="btn btn-ghost btn-block" onClick={onCancel}>返回</button>
    </div>
  )

  return (
    <div>
      {/* Challenge instruction */}
      <div className="card" style={{
        marginBottom: 12,
        borderColor: 'var(--accent)',
        textAlign: 'center',
        padding: '10px 16px',
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>{hint}</div>
        <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--accent)' }}>{challenge}</div>
      </div>

      <div className="camera-container">
        {!captured ? (
          <>
            {loading && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="spinner" />
              </div>
            )}
            <video ref={videoRef} playsInline muted />
            {!loading && <button className="camera-shutter" onClick={shoot} />}
          </>
        ) : (
          <img src={captured} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={captured ? handleRetake : onCancel}
        >
          {captured ? '重拍' : '取消'}
        </button>
        {captured && (
          <button className="btn btn-primary" style={{ flex: 2 }} onClick={() => onCapture(captured)}>
            {submitLabel}
          </button>
        )}
        {!captured && (
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </div>
  )
}
