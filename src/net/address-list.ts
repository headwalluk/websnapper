import { BlockList, isIP } from 'node:net';

const IPV4_MAPPED_PREFIX = '::ffff:';
const IPV4_MAX_PREFIX = 32;
const IPV6_MAX_PREFIX = 128;

/** A set of IP addresses and CIDR ranges that an address can be tested against. */
export interface AddressList {
  readonly entries: readonly string[];
  matches(address: string): boolean;
}

/** Strips the IPv4-mapped IPv6 prefix that dual-stack sockets report (::ffff:192.0.2.1). */
export function normaliseAddress(address: string): string {
  const lowered = address.toLowerCase();
  const unmapped = lowered.startsWith(IPV4_MAPPED_PREFIX) ? lowered.slice(IPV4_MAPPED_PREFIX.length) : lowered;
  return isIP(unmapped) === 4 ? unmapped : lowered;
}

/** Adds one "address" or "address/prefix" entry to the block list; false when it is malformed. */
function addEntry(blockList: BlockList, entry: string): boolean {
  const [address = '', prefixText, extra] = entry.split('/');
  const family = isIP(address);
  const maxPrefix = family === 4 ? IPV4_MAX_PREFIX : IPV6_MAX_PREFIX;
  const prefix = prefixText === undefined ? undefined : Number(prefixText);
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
