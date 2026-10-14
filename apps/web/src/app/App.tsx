import { useEffect, useState } from 'react';
import { loadLiveness, type LivenessState } from '../shared/liveness';

/**
 * Presentational shell. It renders exactly what the container knows: no data
 * fetching, no side effects.
 */
export function AppShell({ liveness }: { liveness: LivenessState }) {
  return (
    <main>
      <h1>Agent Chat</h1>
      <p>{describeLiveness(liveness)}</p>
    </main>
  );
}

/** Container. Loads the liveness state once and hands it to the shell. */
export function App() {
  const [liveness, setLiveness] = useState<LivenessState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void loadLiveness().then((state) => {
      if (!cancelled) {
        setLiveness(state);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return <AppShell liveness={liveness} />;
}

export function describeLiveness(liveness: LivenessState): string {
  switch (liveness.status) {
    case 'loading':
      return 'Server: checking';
    case 'ok':
      return `Server: ok (database: ${liveness.database})`;
    case 'error':
      return `Server: error (HTTP ${liveness.httpStatus})`;
    case 'unreachable':
      return 'Server: unreachable';
  }
}
