import { keccak256, bytesToHex } from 'viem'

// DUO public-event bet: the opponent's invite secret travels only in the URL fragment (#).
// The chain stores keccak256(secret) on the open challenger slot; joinCommitment(secret)
// burns it and binds the opponent as party[1] (the opposite side of the creator's bet).
// The opponent is indexed on-chain via getUserCommitments, so no client-side job list is needed.

export function makeBetSecret(): `0x${string}` {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return bytesToHex(b)
}

/// Matches the contract's keccak256(abi.encodePacked(secret)) for a bytes32 secret.
export function betHash(secret: `0x${string}`): `0x${string}` {
  return keccak256(secret)
}

export function betLink(id: bigint | string, secret: string): string {
  return `${window.location.origin}/b/${id.toString()}#${secret}`
}

export function storeBetSecret(id: bigint | string, secret: string): void {
  localStorage.setItem(`pact_bet_${id.toString()}`, secret)
}

export function getBetSecret(id: bigint | string): string | null {
  return localStorage.getItem(`pact_bet_${id.toString()}`)
}
