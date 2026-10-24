import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';


const excluded = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) excluded.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) excluded.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !excluded.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !excluded.check(address, 'ipv6');
}
export function approvedWebhook(value: string, hosts: string[]): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || (url.port && url.port !== '443') ||
      !hosts.includes(url.hostname) || !url.hostname.includes('.') || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.') || isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Webhook destination is not approved');
  return url;
}
export interface WebhookDelivery { notify(wake: Record<string, string>, signal: AbortSignal): Promise<number> }
/** Production transport pins the checked DNS address for this connection and preserves TLS hostname verification. */
export function webhookTransport(value: string, bearer: string): WebhookDelivery {
  const hosts = [new URL(value).hostname];
  const url = approvedWebhook(value, hosts);
  if (!bearer || /[\r\n]/.test(bearer)) throw new Error('Webhook credential unavailable');
  return { async notify(wake, signal) {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
    // DNS lookup cannot be cancelled by the OS, but a cancelled/expired lookup must not dispatch later.
    const resolved = lookup(url.hostname, { all: true, verbatim: true });
    const answers = await new Promise<LookupAddress[]>((resolve, reject) => {
      const abort = () => reject(new Error('Webhook dispatch unconfirmed'));
      deadline.addEventListener('abort', abort, { once: true });
      if (deadline.aborted) abort();
      void resolved.then(resolve, reject).finally(() => deadline.removeEventListener('abort', abort));
    });
    if (deadline.aborted || !answers.length || answers.some(item => !publicAddress(item.address))) throw new Error('Webhook address is not public');
    const address = answers[0]!;
    return await new Promise<number>((resolve, reject) => {
      const body = JSON.stringify(wake);
      const req = request({ hostname: address.address, family: address.family, servername: url.hostname, port: 443, path: url.pathname,
        method: 'POST', agent: false, signal: deadline, headers: { host: url.host, authorization: `Bearer ${bearer}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
        // Do not follow redirects, consume provider bodies or interpret 200 as completion.
        const status = response.statusCode ?? 0; response.destroy(); resolve(status);
      });
      req.once('error', () => reject(new Error('Webhook dispatch unconfirmed'))); req.end(body);
    });
  } };
}
