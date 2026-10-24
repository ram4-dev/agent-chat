import { expect, it } from 'vitest';
import { approvedWebhook, publicAddress } from '../../apps/bridge/src/native/grok-transport';
it('only approves exact HTTPS cloud hosts and rejects credential-bearing URLs, redirects destinations and local endpoints', () => {
  expect(approvedWebhook('https://hooks.grok.example/routine', ['hooks.grok.example']).hostname).toBe('hooks.grok.example');
  for (const url of ['http://hooks.grok.example/routine','https://hooks.grok.example:444/routine','https://user:secret@hooks.grok.example/routine','https://hooks.grok.example/routine?secret=x','https://hooks.grok.example/#fragment','https://evil.example/routine','https://hooks.grok.example.evil/routine','https://127.0.0.1/routine','https://[::1]/','https://agent-chat.localhost/']) expect(() => approvedWebhook(url, ['hooks.grok.example','127.0.0.1','[::1]','agent-chat.localhost'])).toThrow();
});
it('rejects private, link-local, mapped and transition addresses in either IP family', () => {
  for (const ip of ['0.0.0.0','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.31.0.1','192.168.2.1','192.0.2.1','198.18.0.1','198.51.100.2','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1','fc00::1','fe80::1','64:ff9b::7f00:1','2002:7f00:1::','2001:db8::1','3fff::1','invalid']) expect(publicAddress(ip), ip).toBe(false);
  for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111','2001:4860:4860::8888']) expect(publicAddress(ip), ip).toBe(true);
});
