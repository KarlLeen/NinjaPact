import { keccak256, bytesToHex } from 'viem'

// Witness invite: a random bytes32 secret travels in the URL fragment (#) only.
// The chain stores witnessInviteHash = keccak256(secret); on accept the hash is burned.

export function makeWitnessSecret(): `0x${string}` {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return bytesToHex(b)
}

/// Matches the contract's keccak256(abi.encodePacked(secret)) for a bytes32 secret.
export function witnessHash(secret: `0x${string}`): `0x${string}` {
  return keccak256(secret)
}

export function witnessLink(id: bigint | string, secret: string): string {
  return `${window.location.origin}/w/${id.toString()}#${secret}`
}

export function storeWitnessSecret(id: bigint | string, secret: string): void {
  localStorage.setItem(`pact_witness_${id.toString()}`, secret)
}

export function getWitnessSecret(id: bigint | string): string | null {
  return localStorage.getItem(`pact_witness_${id.toString()}`)
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
