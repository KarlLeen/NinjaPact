import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { verifyMessage } from 'viem'
import { randomBytes } from 'crypto'

export const authRouter = Router()

// Nonce store: nonce → { address: null, expiry }
// After /auth, nonce is deleted (single-use)
const nonces = new Map<string, number>()

const NONCE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const JWT_TTL_S = 60 * 60           // 1 hour

function pruneNonces() {
  const now = Date.now()
  for (const [n, exp] of nonces) {
    if (now > exp) nonces.delete(n)
  }
}

// GET /nonce
authRouter.get('/nonce', (_req, res) => {
  pruneNonces()
  const nonce = randomBytes(16).toString('hex')
  nonces.set(nonce, Date.now() + NONCE_TTL_MS)
  res.json({ nonce })
})

// POST /auth  { message, signature, address }
authRouter.post('/auth', async (req, res) => {
  const { message, signature, address } = req.body as {
    message?: string
    signature?: string
    address?: string
  }

  if (!message || !signature || !address) {
    res.status(400).json({ error: 'Missing fields' })
    return
  }

  // Extract nonce from message
  const nonceMatch = message.match(/nonce:\s*([0-9a-f]{32})/)
  if (!nonceMatch) {
    res.status(400).json({ error: 'Invalid message format' })
    return
  }
  const nonce = nonceMatch[1]

  if (!nonces.has(nonce)) {
    res.status(401).json({ error: 'Nonce expired or unknown' })
    return
  }
  if (Date.now() > (nonces.get(nonce) ?? 0)) {
    nonces.delete(nonce)
    res.status(401).json({ error: 'Nonce expired' })
    return
  }
  nonces.delete(nonce) // single-use

  // Verify signature
  let valid = false
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    })
  } catch {
    valid = false
  }

  if (!valid) {
    res.status(401).json({ error: 'Invalid signature' })
    return
  }

  const secret = process.env.JWT_SECRET ?? 'insecure-change-me'
  const expiresAt = Date.now() + JWT_TTL_S * 1000
  const token = jwt.sign({ address: address.toLowerCase(), exp: Math.floor(expiresAt / 1000) }, secret)

  res.json({ token, expiresAt })
})

// Middleware: verify JWT and attach address to req
export function requireAuth(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing auth token' })
    return
  }
  const token = header.slice(7)
  try {
    const secret = process.env.JWT_SECRET ?? 'insecure-change-me'
    const payload = jwt.verify(token, secret) as { address: string }
    ;(req as import('express').Request & { userAddress: string }).userAddress = payload.address
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
