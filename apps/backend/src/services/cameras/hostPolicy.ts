import dns from "dns";
import net from "net";
import { env } from "../../config/env";
import { AppError } from "../../middleware/errorHandler";

// Which camera addresses the API server may connect to. The camera test opens a connection from the server to an
// address a user typed in, so without a rule a user could use it to scan the server's own network or reach the cloud
// metadata service (169.254.169.254). The rule is checked when a camera is saved and again when it is tested, on the
// address the name resolves to right then (a name can be pointed at an internal address later).

export interface HostPolicy {
  /** 10.x, 172.16-31.x, 192.168.x, 100.64.x and fc00::/7 */
  allowPrivate: boolean;
  /** 127.x and ::1 */
  allowLoopback: boolean;
}

export function currentPolicy(): HostPolicy {
  return { allowPrivate: env.cameraAllowPrivateHosts, allowLoopback: !env.isProduction };
}

function v4Parts(ip: string): [number, number, number, number] | null {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? (p as [number, number, number, number]) : null;
}

// "::ffff:10.0.0.1" and "::ffff:a00:1" are IPv4 addresses written in IPv6 form
function mappedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function v6FirstHextet(ip: string): number {
  const first = ip.toLowerCase().split(":")[0];
  return first === "" ? 0 : parseInt(first, 16);
}

// null means the address is fine; otherwise the reason it is refused.
export function addressBlockReason(ip: string, policy: HostPolicy): string | null {
  const mapped = mappedV4(ip);
  if (mapped) return addressBlockReason(mapped, policy);

  if (net.isIPv4(ip)) {
    const p = v4Parts(ip);
    if (!p) return "not a valid address";
    const [a, b] = p;
    if (a === 0) return "unspecified address";
    if (a === 169 && b === 254) return "link-local address (cloud metadata)";
    if (a >= 224) return "multicast or reserved address";
    if (a === 127) return policy.allowLoopback ? null : "loopback address";
    const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
    if (isPrivate) return policy.allowPrivate ? null : "private network address";
    return null;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::") return "unspecified address";
    if (lower === "::1") return policy.allowLoopback ? null : "loopback address";
    const h = v6FirstHextet(lower);
    if ((h & 0xffc0) === 0xfe80) return "link-local address";
    if ((h & 0xff00) === 0xff00) return "multicast address";
    if ((h & 0xfe00) === 0xfc00) return policy.allowPrivate ? null : "private network address";
    return null;
  }
  return "not a valid address";
}

const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export function isValidHostFormat(host: string): boolean {
  return net.isIP(host) !== 0 || HOSTNAME.test(host);
}

export type Resolved = { ok: true; address: string } | { ok: false; code: "INVALID_HOST" | "ADDRESS_NOT_ALLOWED" | "DNS_FAILED" };

// The address to connect to, or why not. Every address the name resolves to must be allowed, so a name that answers
// with one public and one internal address is refused.
export async function resolveAllowedAddress(host: string, policy: HostPolicy = currentPolicy()): Promise<Resolved> {
  if (!isValidHostFormat(host)) return { ok: false, code: "INVALID_HOST" };
  if (net.isIP(host)) {
    return addressBlockReason(host, policy) ? { ok: false, code: "ADDRESS_NOT_ALLOWED" } : { ok: true, address: host };
  }
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, code: "DNS_FAILED" };
  }
  if (addresses.length === 0) return { ok: false, code: "DNS_FAILED" };
  if (addresses.some((a) => addressBlockReason(a.address, policy))) return { ok: false, code: "ADDRESS_NOT_ALLOWED" };
  return { ok: true, address: addresses[0].address };
}

const NOT_ALLOWED = "This camera address is not allowed. Use the network address of the camera itself.";

// Used when a camera is saved. A name that cannot be resolved from here is accepted (it may only exist on the
// customer's network); it is checked again when the camera is tested.
export async function assertCameraHostAllowed(host: string, policy: HostPolicy = currentPolicy()): Promise<void> {
  const result = await resolveAllowedAddress(host.trim(), policy);
  if (result.ok || result.code === "DNS_FAILED") return;
  throw new AppError(400, "VALIDATION_ERROR", result.code === "INVALID_HOST" ? "The camera host is not a valid address or name." : NOT_ALLOWED);
}
