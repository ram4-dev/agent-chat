import { useEffect, useMemo, useRef, useState } from 'react';
import { createReadQueue } from './readQueue';
import { markDisplayedMessagesRead } from './transport';

/**
 * Bridge for ChatContainer.onMessagesDisplayed. The emitter sends exact visible
 * IDs in history order and re-emits on focus/visibility restoration. Socket
 * messages and group-list metadata must never be passed to this callback.
 */
export function useGroupRead(groupId: string | undefined, enabled: boolean, onChanged: () => void) {
  const [readError, setReadError] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const queue = useMemo(() => createReadQueue({
    canRead: () => !!groupId && enabled && document.visibilityState === 'visible' && document.hasFocus(),
    send: ids => markDisplayedMessagesRead(groupId!, ids),
    onChanged: () => changed.current(),
    onError: (failed, status) => {
      setReadError(failed);
      if (status === 401 || status === 403 || status === 404) changed.current();
    },
  }), [groupId, enabled]);
  useEffect(() => {
    queue.activate();
    setReadError(false);
    const pause = () => {
      if (document.visibilityState !== 'visible' || !document.hasFocus()) queue.pause();
    };
    document.addEventListener('visibilitychange', pause);
    window.addEventListener('blur', pause);
    return () => {
      queue.dispose();
      document.removeEventListener('visibilitychange', pause);
      window.removeEventListener('blur', pause);
    };
  }, [queue]);
  return { onMessagesDisplayed: queue.display, readError, retryRead: queue.retry };
}
