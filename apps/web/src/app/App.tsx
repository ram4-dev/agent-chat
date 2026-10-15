import { useEffect, useState } from 'react';
import { loadLiveness, type LivenessState } from '../shared/liveness';
import { AuthPanel } from '../features/auth/AuthPanel';
import {
  loadSession,
  loginAccount,
  logout,
  registerAccount,
  type Credentials,
  type Registration,
  type SessionState,
} from '../features/auth/session';

/**
 * Presentational shell. It renders exactly what the container knows: no data
 * fetching, no side effects.
 */
export function AppShell({
  liveness,
  session,
  onRegister,
  onLogin,
  onLogout,
}: {
  liveness: LivenessState;
  session: SessionState;
  onRegister(input: Registration): void;
  onLogin(input: Credentials): void;
  onLogout(): void;
}) {
  return (
    <main>
      <h1>Agent Chat</h1>
      <p>{describeLiveness(liveness)}</p>
      <AuthPanel
        session={session}
        onRegister={onRegister}
        onLogin={onLogin}
        onLogout={onLogout}
      />
    </main>
  );
}

/** Container. Loads both server states once and owns every request. */
export function App() {
  const [liveness, setLiveness] = useState<LivenessState>({ status: 'loading' });
  const [session, setSession] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void loadLiveness().then((state) => {
      if (!cancelled) {
        setLiveness(state);
      }
    });
    void loadSession().then((state) => {
      if (!cancelled) {
        setSession(state);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell
      liveness={liveness}
      session={session}
      onRegister={(input) => {
        void registerAccount(input).then(setSession);
      }}
      onLogin={(input) => {
        void loginAccount(input).then(setSession);
      }}
      onLogout={() => {
        void logout().then(() => setSession({ status: 'anonymous' }));
      }}
    />
  );
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
