import { useId, useState, type FormEvent } from "react";
import {
  describeRejection,
  type Credentials,
  type Registration,
  type SessionState,
} from "./session";
import { Brand, Icon } from "../../shared/ui";
import { RecoveryRequest } from './RecoveryPanel';

export function AuthPanel({
  session,
  onRegister,
  onLogin,
}: {
  session: SessionState;
  onRegister(input: Registration): Promise<void>;
  onLogin(input: Credentials): Promise<void>;
}) {
  const accessId = useId();
  const [mode, setMode] = useState<"register" | "login">("register");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const input = {
      email: String(data.get("email")),
      password: String(data.get("password")),
    };
    setBusy(true);
    try {
      if (mode === "register")
        await onRegister({
          ...input,
          displayName: String(data.get("displayName")),
        });
      else await onLogin(input);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="Agent Chat">
        <Brand />
        <div className="auth-pitch">
          <span className="eyebrow">PERSONAS + AGENTES</span>
          <h1>
            El equipo completo.
            <br />
            En la misma
            <br />
            <em>conversación.</em>
          </h1>
          <p>
            Un espacio privado para conversar con tu equipo y sumar los agentes
            que vos elegís.
          </p>
          <div className="orbit" aria-hidden="true">
            <span className="orbit-line" />
            <span className="orbit-person">VOS</span>
            <span className="orbit-center">
              <Icon name="chat" />
            </span>
            <span className="orbit-agent">
              <Icon name="bot" /> TUS AGENTES
            </span>
            <span className="orbit-team">
              <Icon name="people" /> TU EQUIPO
            </span>
          </div>
        </div>
        <p className="auth-footnote">
          <Icon name="lock" /> Grupos privados. Identidades claras.
        </p>
      </section>
      <section className="auth-form-side" aria-label="Acceso">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <div className="auth-card">
          <span className="eyebrow">BIENVENIDO A AGENT CHAT</span>
          <h2>
            {mode === "register"
              ? "Hacé lugar a tu equipo."
              : "Qué bueno verte de nuevo."}
          </h2>
          <p className="muted">
            {mode === "register"
              ? "Creá tu cuenta para empezar una conversación."
              : "Ingresá para volver a tus conversaciones."}
          </p>
          <div
            className="segmented"
            role="tablist"
            aria-label="Tipo de acceso"
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "register"
                  : event.key === "End"
                    ? "login"
                    : mode === "register"
                      ? "login"
                      : "register";
              setMode(next);
              document.getElementById(`${accessId}-${next}`)?.focus();
            }}
          >
            <button
              role="tab"
              id={`${accessId}-register`}
              aria-selected={mode === "register"}
              tabIndex={mode === "register" ? 0 : -1}
              aria-controls={`${accessId}-panel`}
              type="button"
              className={mode === "register" ? "selected" : ""}
              onClick={() => setMode("register")}
            >
              Crear cuenta
            </button>
            <button
              role="tab"
              id={`${accessId}-login`}
              aria-selected={mode === "login"}
              tabIndex={mode === "login" ? 0 : -1}
              aria-controls={`${accessId}-panel`}
              type="button"
              className={mode === "login" ? "selected" : ""}
              onClick={() => setMode("login")}
            >
              Ingresar
            </button>
          </div>
          <form
            id={`${accessId}-panel`}
            role="tabpanel"
            aria-labelledby={`${accessId}-${mode}`}
            onSubmit={(event) => {
              void submit(event);
            }}
            className="form-stack"
            key={mode}
          >
            {mode === "register" && (
              <label>
                Nombre
                <input
                  name="displayName"
                  placeholder="Cómo te llama tu equipo"
                  autoComplete="name"
                  required
                  maxLength={80}
                />
              </label>
            )}
            <label>
              Correo electrónico
              <input
                name="email"
                type="email"
                placeholder="vos@equipo.com"
                autoComplete="email"
                required
              />
            </label>
            <label>
              Contraseña
              <input
                name="password"
                type="password"
                placeholder={
                  mode === "register"
                    ? "Al menos 12 caracteres"
                    : "Tu contraseña"
                }
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                required
                minLength={mode === "register" ? 12 : 1}
                maxLength={128}
              />
            </label>
            {session.status === "confirmation_required" && (
              <p className="info-note" role="status">
                Revisá tu correo. Al confirmar la cuenta vas a ingresar automáticamente.
              </p>
            )}
            {session.status === "rejected" && (
              <p className="error-box" role="alert">
                {describeRejection(session.code)}
              </p>
            )}
            {session.status === "error" && (
              <p className="error-box" role="alert">
                No pudimos conectar. Revisá tu conexión e intentá de nuevo.
              </p>
            )}
            <button
              className="button primary full"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "Un momento…"
                : mode === "register"
                  ? "Crear cuenta"
                  : "Ingresar"}
              <Icon name="arrow" />
            </button>
          </form>
          <button className="text-button" type="button" onClick={() => setRecovering(true)}>Olvidé mi contraseña</button>
          {recovering && <RecoveryRequest onClose={() => setRecovering(false)} />}
          <p className="auth-note">
            Tus agentes siempre tienen su propia identidad.
            <br />
            Vos decidís a qué grupos pueden entrar.
          </p>
        </div>
        <p className="auth-bottom">Un lugar para trabajar juntos.</p>
      </section>
    </main>
  );
}
