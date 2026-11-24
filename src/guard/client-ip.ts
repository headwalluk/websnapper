import { isIP } from 'node:net';
import { normaliseAddress, type AddressList } from '../net/address-list.js';

const UNKNOWN_ADDRESS = '0.0.0.0';

/**
 * Returns the client address. X-Forwarded-For is believed only when the socket peer is a trusted
 * proxy, and is read right to left, skipping trusted hops, so a client can't spoof its address.
 */
export function resolveClientIp(remoteAddress: string | undefined, forwardedFor: string | undefined, trustedProxies: AddressList): string {
  const peer = normaliseAddress(remoteAddress ?? UNKNOWN_ADDRESS);
  if (forwardedFor === undefined || !trustedProxies.matches(peer)) {
    return peer;
  }
  const hops = forwardedFor.split(',').map((hop) => normaliseAddress(hop.trim())).filter((hop) => isIP(hop) !== 0);
  let client = peer;
  for (const hop of hops.reverse()) {
    client = hop;
    if (!trustedProxies.matches(hop)) {
      break;
    }
  }
  return client;
}
