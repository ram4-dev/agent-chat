import console from 'node:console';
import process from 'node:process';
console.log(JSON.stringify({ fixturePid: process.pid }));
await import('../../../apps/server/dist/main.js');
