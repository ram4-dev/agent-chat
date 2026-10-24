import { expect,it } from 'vitest';
import { approvedWebhook,publicAddress,webhookTransport } from '../../apps/server/src/notifications/transport';

it('restricts webhook destinations to public HTTPS without embedded credentials',()=>{
  for(const value of ['http://hooks.example.com/wake','https://127.0.0.1/wake','https://[::1]/wake','https://hooks.localhost/wake',
    'https://user:password@hooks.example.com/wake','https://hooks.example.com:444/wake','https://hooks.example.com/wake?key=private','https://hooks.example.com/wake#key']){
    expect(()=>approvedWebhook(value,[new URL(value).hostname])).toThrow();
  }
  expect(approvedWebhook('https://hooks.example.com/wake',['hooks.example.com']).pathname).toBe('/wake');
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.94.34.87','192.168.1.1','::1','fc00::1','::ffff:127.0.0.1','2001:db8::1'])expect(publicAddress(address)).toBe(false);
  expect(publicAddress('8.8.8.8')).toBe(true);
  expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  expect(()=>webhookTransport('https://hooks.example.com/wake','bad\r\nheader')).toThrow();
});
