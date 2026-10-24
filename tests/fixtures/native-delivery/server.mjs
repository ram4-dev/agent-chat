import console from 'node:console';
import process from 'node:process';
console.log(JSON.stringify({ fixturePid: process.pid }));
const { serverStarted } = await import('../../../apps/server/dist/main.js');
await serverStarted;

console.log(JSON.stringify({ fixtureServerReady: true }));
