import { useState } from 'react';
import { Brand, Modal } from '../../shared/ui';

export function RecoveryRequest({ onClose }: { onClose(): void }) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  return <Modal title="Recuperar acceso" onClose={onClose}>
    {sent ? <p role="status">Si existe una cuenta con ese correo, vas a recibir un enlace para cambiar la contraseña.</p> :
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        const email = String(new FormData(event.currentTarget).get('email'));
        setBusy(true); setError('');
        void fetch('/api/auth/recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
          .then((response) => { if (!response.ok) throw new Error(); setSent(true); })
          .catch(() => setError('No pudimos solicitar el enlace. Esperá un momento e intentá de nuevo.'))
          .finally(() => setBusy(false));
      }}>
        <label>Correo de la cuenta<input name="email" type="email" autoComplete="email" required /></label>
        {error && <p className="error-box" role="alert">{error}</p>}
        <button className="button primary" type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Enviar enlace'}</button>
      </form>}
  </Modal>;
}

/** Human recovery credentials live only in memory, never browser storage or rendered inputs. */
export function RecoveryPanel({ token, onDone }: { token: string; onDone(): void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  return <main className="app-loading"><section className="auth-card" aria-label="Cambiar contraseña">
    <Brand /><h1>Nueva contraseña</h1>
    {done ? <><p role="status">Tu contraseña cambió. Volvé a ingresar para continuar.</p><button className="button primary" onClick={onDone}>Volver a ingresar</button></> :
      <form className="form-stack" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const password = String(data.get('password'));
        if (password !== data.get('confirmation')) { setError('Las contraseñas no coinciden.'); return; }
        setBusy(true); setError('');
        void fetch('/api/auth/reset-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password, accessToken: token }) })
          .then((response) => { if (!response.ok) throw new Error(); setDone(true); })
          .catch(() => setError('No pudimos cambiar la contraseña. El enlace puede haber vencido o ya haberse usado. Pedí uno nuevo si el problema continúa.'))
          .finally(() => setBusy(false));
      }}>
        <label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
        <label>Repetir contraseña<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
        {error && <p className="error-box" role="alert">{error}</p>}
        <button className="button primary" type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button>
        <button className="text-button" type="button" onClick={onDone}>Volver al acceso</button>
      </form>}
  </section></main>;
}
