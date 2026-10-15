import { useState, type FormEvent } from 'react';
import type { PublicUser } from '@agent-chat/contracts';
import { describeRejection, type Credentials, type Registration, type SessionState } from './session';

export interface AuthPanelProps {
  session: SessionState;
  onRegister(input: Registration): void;
  onLogin(input: Credentials): void;
  onLogout(): void;
}

const EMPTY_FORM = {
  email: '',
  displayName: '',
  password: '',
};

/**
 * Presentational session form.
 *
 * It owns only the draft values in the inputs; every request and every decision
 * about what the response means lives in the container. The password never
 * leaves the form except as the argument of a single submit.
 */
export function AuthPanel({ session, onRegister, onLogin, onLogout }: AuthPanelProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [mode, setMode] = useState<'register' | 'login'>('register');

  if (session.status === 'authenticated') {
    return (
      <section aria-label="Session">
        <p>Signed in as {session.user.displayName}.</p>
        <button type="button" onClick={onLogout}>
          Sign out
        </button>
      </section>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const values = { email: form.email, password: form.password };
    if (mode === 'register') {
      onRegister({ ...values, displayName: form.displayName });
    } else {
      onLogin(values);
    }
  }

  return (
    <section aria-label="Session">
      <h2>{mode === 'register' ? 'Create an account' : 'Sign in'}</h2>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />
        {mode === 'register' && (
          <>
            <label htmlFor="displayName">Display name</label>
            <input
              id="displayName"
              type="text"
              autoComplete="name"
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            />
          </>
        )}
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
        <button type="submit">{mode === 'register' ? 'Create account' : 'Sign in'}</button>
      </form>
      <button type="button" onClick={() => setMode(mode === 'register' ? 'login' : 'register')}>
        {mode === 'register' ? 'I already have an account' : 'Create an account instead'}
      </button>
      <p role="status">{describeSession(session)}</p>
    </section>
  );
}

/** One truthful sentence for whatever the container knows right now. */
export function describeSession(session: SessionState): string {
  switch (session.status) {
    case 'loading':
      return 'Checking your session…';
    case 'anonymous':
      return 'You are not signed in.';
    case 'authenticated':
      return `Signed in as ${session.user.displayName}.`;
    case 'rejected':
      return describeRejection(session.code);
    case 'error':
      return 'The server did not answer. Your session is unknown.';
  }
}

export type { PublicUser };
