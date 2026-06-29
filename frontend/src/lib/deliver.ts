import { keccak256, bytesToHex } from 'viem'

// Deliverer invite (escrow / DEPOSIT mode): a random bytes32 secret travels in the
// URL fragment (#) only. The chain stores the invite hash = keccak256(secret) on an
// open slot; joinCommitment(secret) burns it and binds the deliverer as party[1].

export function makeDeliverSecret(): `0x${string}` {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return bytesToHex(b)
}

/// Matches the contract's keccak256(abi.encodePacked(secret)) for a bytes32 secret.
export function deliverHash(secret: `0x${string}`): `0x${string}` {
  return keccak256(secret)
}

export function deliverLink(id: bigint | string, secret: string): string {
  return `${window.location.origin}/d/${id.toString()}#${secret}`
}

export function storeDeliverSecret(id: bigint | string, secret: string): void {
  localStorage.setItem(`pact_deliver_${id.toString()}`, secret)
}

export function getDeliverSecret(id: bigint | string): string | null {
  return localStorage.getItem(`pact_deliver_${id.toString()}`)
}

// Jobs this device accepted AS THE DELIVERER. The contract only indexes commitments
// under their creator (getUserCommitments), so we record accepted jobs client-side so
// the deliverer can find them again. Keyed by deliverer address. Re-visiting /d/:id
// works without the secret once you're party[1] (the secret is only for the join).
export function storeDeliverJob(address: string, id: bigint | string): void {
  const cur = getDeliverJobs(address)
  const idStr = id.toString()
  if (!cur.includes(idStr)) {
    localStorage.setItem(`np_deliver_jobs_${address.toLowerCase()}`, JSON.stringify([...cur, idStr]))
  }
}

export function getDeliverJobs(address: string): string[] {
  try { return JSON.parse(localStorage.getItem(`np_deliver_jobs_${address.toLowerCase()}`) ?? '[]') as string[] }
  catch { return [] }
}
