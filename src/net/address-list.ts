import { BlockList, isIP } from 'node:net';

const IPV4_MAPPED_PREFIX = '::ffff:';
const IPV4_MAPPED_HEX_PATTERN = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;
const PREFIX_PATTERN = /^\d{1,3}$/;
const IPV4_MAX_PREFIX = 32;
const IPV6_MAX_PREFIX = 128;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;
const HEX_RADIX = 16;

/** A set of IP addresses and CIDR ranges that an address can be tested against. */
export interface AddressList {
  readonly entries: readonly string[];
  matches(address: string): boolean;
}

/** Converts the hex form of an IPv4-mapped address (::ffff:c000:201) to dotted IPv4. */
function unmapHexIpv4(canonical: string): string | null {
  const groups = IPV4_MAPPED_HEX_PATTERN.exec(canonical);
  const high = groups?.[1];
  const low = groups?.[2];
  return high === undefined || low === undefined
    ? null
    : [high, low].flatMap((group) => {
      const value = Number.parseInt(group, HEX_RADIX);
      return [value >> BITS_PER_BYTE, value & BYTE_MASK];
    }).join('.');
}

/** Returns the RFC 5952 form of an IPv6 address, or null when the URL parser rejects it (zone IDs). */
function canonicalIpv6(address: string): string | null {
  const bracketed = `http://[${address}]`;
  return URL.canParse(bracketed) ? new URL(bracketed).hostname.slice(1, -1) : null;
}

/** Returns one spelling per address: dotted IPv4 for IPv4-mapped IPv6, RFC 5952 for other IPv6. */
export function normaliseAddress(address: string): string {
  const lowered = address.trim().toLowerCase();
  const unmapped = lowered.startsWith(IPV4_MAPPED_PREFIX) ? lowered.slice(IPV4_MAPPED_PREFIX.length) : lowered;
  let normalised = lowered;
  if (isIP(unmapped) === 4) {
    normalised = unmapped;
  } else if (isIP(lowered) === 6) {
    const canonical = canonicalIpv6(lowered) ?? lowered;
    normalised = unmapHexIpv4(canonical) ?? canonical;
  }
  return normalised;
}

/** Adds one "address" or "address/prefix" entry to the block list; false when it is malformed. */
function addEntry(blockList: BlockList, entry: string): boolean {
  const [address = '', prefixText, extra] = entry.split('/');
  const family = isIP(address);
  const maxPrefix = family === 4 ? IPV4_MAX_PREFIX : IPV6_MAX_PREFIX;
  // Number('') is 0, so an empty prefix would otherwise become a whole-family /0.
  const prefix = prefixText === undefined ? undefined : PREFIX_PATTERN.test(prefixText) ? Number(prefixText) : Number.NaN;
  const isValid = family !== 0 && extra === undefined
    && (prefix === undefined || (Number.isInteger(prefix) && prefix >= 0 && prefix <= maxPrefix));
  if (isValid) {
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) {
      blockList.addAddress(address, type);
    } else {
      blockList.addSubnet(address, prefix, type);
    }
  }
  return isValid;
}

/** Builds an AddressList from entries, reporting any that are not an IP or CIDR range. */
export function parseAddressList(entries: readonly string[]): { list: AddressList; invalidEntries: string[] } {
  const blockList = new BlockList();
  const invalidEntries = entries.filter((entry) => !addEntry(blockList, entry));
  const list: AddressList = {
    entries,
    matches: (address) => {
      const normalised = normaliseAddress(address);
      const family = isIP(normalised);
      return family !== 0 && blockList.check(normalised, family === 4 ? 'ipv4' : 'ipv6');
    },
  };
  return { list, invalidEntries };
}
