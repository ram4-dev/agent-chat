import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDisplayedMessages } from '../../apps/web/src/features/chat/useDisplayedMessages';
const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { Window } = require('happy-dom');
const { createElement, useRef, act } = require('react');
const { createRoot } = require('react-dom/client');

let window: InstanceType<typeof Window>;
let root: ReturnType<typeof createRoot>;
let visibility = 'visible';
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
const observers: TestObserver[] = [];
class TestObserver {
  targets: Element[] = [];
  disconnected = false;
  constructor(readonly callback: IntersectionObserverCallback) { observers.push(this); }
  observe(target: Element) { this.targets.push(target); }
  disconnect() { this.disconnected = true; }
  emit(ids: string[]) {
    this.callback(this.targets.map(target => ({ target, isIntersecting: ids.includes((target as HTMLElement).dataset['visibleMessageId']!), intersectionRect: { width: 100, height: 100 } } as IntersectionObserverEntry)), this as unknown as IntersectionObserver);
  }
}
async function flush() {
  await act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); });
}
beforeEach(() => {
  window = new Window(); visibility = 'visible'; frames = new Map(); observers.length = 0;
  vi.stubGlobal('window', window); vi.stubGlobal('document', window.document);
  vi.stubGlobal('innerWidth', 800); vi.stubGlobal('innerHeight', 600);
  vi.stubGlobal('IntersectionObserver', TestObserver);
  vi.stubGlobal('MutationObserver', window.MutationObserver);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  const container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); }); window.happyDOM.abort(); vi.unstubAllGlobals(); });

async function mount(ids: string[], report: (ids: readonly string[]) => void) {
  function Fixture() {
    const scroll = useRef(null);
    useDisplayedMessages(scroll, ids, report);
    return createElement('div', { ref: scroll, id: 'scroll' }, ids.map(id => createElement('article', { key: id, 'data-visible-message-id': id }, id)));
  }
  await act(async () => { root.render(createElement(Fixture)); });
  vi.spyOn(document.getElementById('scroll')!, 'getBoundingClientRect').mockReturnValue(new window.DOMRect(0, 0, 500, 400));
  for (const node of document.querySelectorAll('[data-visible-message-id]')) {
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(new window.DOMRect(0, 50, 200, 50));
  }
  return observers.at(-1)!;
}
describe('visible conversation history reporting', () => {
  it('batches observer events in ascending history order and ignores unloaded IDs', async () => {
    const report = vi.fn(); const observer = await mount(['old', 'middle', 'new'], report);
    observer.emit(['new', 'old', 'unloaded']); observer.emit(['new', 'old']);
    expect(report).not.toHaveBeenCalled(); await flush();
    expect(report).toHaveBeenCalledExactlyOnceWith(['old', 'new']);
  });
  it('re-reports actually visible messages on focus restoration without a new observer event', async () => {
    const report = vi.fn(); const observer = await mount(['old'], report);
    observer.emit(['old']); await flush(); report.mockClear();
    window.dispatchEvent(new window.Event('focus')); await flush();
    expect(report).toHaveBeenCalledExactlyOnceWith(['old']);
  });
  it('does not mark a new offscreen message while scrolled up or a clipped article as displayed', async () => {
    const report = vi.fn(); const observer = await mount(['old', 'new'], report);
    vi.spyOn(document.querySelector('[data-visible-message-id="new"]')!, 'getBoundingClientRect').mockReturnValue(new window.DOMRect(0, 450, 200, 50));
    observer.emit(['old', 'new']); await flush();
    expect(report).toHaveBeenCalledExactlyOnceWith(['old']);
  });
  it('does not report articles covered by inert navigation or a native modal', async () => {
    const report = vi.fn(); const observer = await mount(['old'], report);
    const scroll = document.getElementById('scroll')!; scroll.setAttribute('inert', '');
    observer.emit(['old']); await flush(); expect(report).not.toHaveBeenCalled();
    scroll.removeAttribute('inert'); const dialog = document.createElement('dialog'); dialog.setAttribute('open', ''); document.body.append(dialog);
    observer.emit(['old']); await flush(); expect(report).not.toHaveBeenCalled();
    dialog.remove(); document.dispatchEvent(new window.Event('visibilitychange')); await flush();
    expect(report).toHaveBeenCalledWith(['old']);
  });
  it('waits for a visible document and disconnects pending callbacks on unmount', async () => {
    const report = vi.fn(); const observer = await mount(['old'], report);
    visibility = 'hidden'; observer.emit(['old']); await flush();
    expect(report).not.toHaveBeenCalled();
    visibility = 'visible'; document.dispatchEvent(new window.Event('visibilitychange')); await flush();
    expect(report).toHaveBeenCalledExactlyOnceWith(['old']);
    observer.emit(['old']);
    await act(async () => { root.unmount(); }); await flush();
    expect(observer.disconnected).toBe(true); expect(report).toHaveBeenCalledTimes(1);
  });
});
