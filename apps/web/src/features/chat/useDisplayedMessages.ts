import { useEffect, type RefObject } from 'react';

/** Reports only rendered articles intersecting this conversation and the document viewport. */
export function useDisplayedMessages(
  scroll: RefObject<HTMLDivElement | null>,
  historyIds: readonly string[],
  onMessagesDisplayed?: (messageIds: readonly string[]) => void,
) {
  useEffect(() => {
    const root = scroll.current;
    if (!root || !onMessagesDisplayed) return;
    const candidates = new Set<string>();
    const articles = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-visible-message-id]'))
      .map(node => [node.dataset['visibleMessageId']!, node]));
    let frame = 0;
    const report = () => {
      frame = 0;
      if (document.visibilityState !== 'visible' || root.closest('[inert]') || document.querySelector('dialog[open]')) return;
      const bounds = root.getBoundingClientRect();
      const visible = historyIds.filter(id => {
        if (!candidates.has(id)) return false;
        const article = articles.get(id);
        if (!article) return false;
        const rect = article.getBoundingClientRect();
        return rect.bottom > Math.max(0, bounds.top) && rect.top < Math.min(innerHeight, bounds.bottom) &&
          rect.right > Math.max(0, bounds.left) && rect.left < Math.min(innerWidth, bounds.right);
      });
      if (visible.length) onMessagesDisplayed(visible);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(report); };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset['visibleMessageId']!;
        if (entry.isIntersecting && entry.intersectionRect.height > 0 && entry.intersectionRect.width > 0) candidates.add(id);
        else candidates.delete(id);
      }
      schedule();
    }, { root, threshold: 0 });
    root.querySelectorAll('[data-visible-message-id]').forEach(node => observer.observe(node));
    const occlusion = new MutationObserver(schedule);
    occlusion.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert', 'open'], childList: true });
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('focus', schedule);
    root.addEventListener('scroll', schedule, { passive: true });
    return () => {
      observer.disconnect(); occlusion.disconnect(); cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('focus', schedule);
      root.removeEventListener('scroll', schedule);
    };
  }, [scroll, historyIds, onMessagesDisplayed]);
}
