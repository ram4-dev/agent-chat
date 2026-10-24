import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function restoreFocus(previous: HTMLElement | null) {
  requestAnimationFrame(() => {
    if (document.querySelector("dialog[open]")) return;
    const available = (element: HTMLElement | null): element is HTMLElement =>
      !!element?.isConnected &&
      element !== document.body &&
      !element.closest("[inert]") &&
      !element.matches(":disabled") &&
      element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility !== "hidden";
    if (available(previous)) {
      previous.focus();
      return;
    }
    const menu = document.querySelector<HTMLElement>(
      '.workspace button[aria-controls="workspace-navigation"]',
    );
    if (available(menu)) menu.focus();
    else document.querySelector<HTMLElement>("main.workspace")?.focus();
  });
}

export type IconName =
  | "chat"
  | "bot"
  | "plus"
  | "arrow"
  | "chevron"
  | "close"
  | "menu"
  | "people"
  | "link"
  | "settings"
  | "logout"
  | "lock"
  | "check"
  | "copy"
  | "refresh"
  | "send";
const paths: Record<IconName, ReactNode> = {
  chat: (
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9.5a8.5 8.5 0 0 1 17 0Z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  bot: (
    <>
      <rect x="4" y="7" width="16" height="13" rx="4" />
      <path d="M12 3v4M8 12v2m8-2v2M9 17h6M1 12v4m22-4v4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="m5 12 14 0m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 9v-3a5 5 0 0 0-3-4" />
    </>
  ),
  link: (
    <>
      <path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="16" cy="17" r="3" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H4v16h5m5-12 4 4-4 4m-5-4h10" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" />
    </>
  ),
  send: (
    <>
      <path d="m3 3 19 9-19 9 4-9-4-9Zm4 9h15" />
    </>
  ),
};
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon name="chat" />
      </span>
      <span>
        agent<span className="brand-light">chat</span>
        <span className="brand-dot">.</span>
      </span>
    </span>
  );
}
export function Avatar({
  name,
  bot = false,
  large = false,
}: {
  name: string;
  bot?: boolean;
  large?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`avatar ${bot ? "avatar-bot" : ""} ${large ? "avatar-large" : ""}`}
    >
      {bot ? (
        <Icon name="bot" />
      ) : (
        name
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join("")
          .toUpperCase()
      )}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      restoreFocus(previous);
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      aria-modal="true"
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <h2 id={id}>{title}</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Cerrar ventana"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function CopyField({ value, label }: { value: string; label: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="copy-wrap">
      <label htmlFor={id}>{label}</label>
      <span className="copy-field">
        <input
          id={id}
          readOnly
          value={value}
          onFocus={(event) => event.target.select()}
        />
        <button
          className="icon-button"
          type="button"
          aria-label={`Copiar ${label.toLowerCase()}`}
          onClick={() => {
            if (!navigator.clipboard) {
              setFailed(true);
              return;
            }
            void navigator.clipboard
              .writeText(value)
              .then(() => {
                setCopied(true);
                setFailed(false);
              })
              .catch(() => setFailed(true));
          }}
        >
          <Icon name={copied ? "check" : "copy"} />
        </button>
      </span>
      <span className="field-hint" role="status">
        {copied
          ? "Copiado."
          : failed
            ? "Seleccioná y copiá el texto del campo."
            : ""}
      </span>
    </div>
  );
}
export function errorMessage(code?: string): string {
  switch (code) {
    case "not_found":
      return "No encontramos ese recurso o ya no tenés acceso.";
    case "forbidden":
      return "No tenés permiso para hacer este cambio.";
    case "conflict":
      return "El cambio entra en conflicto con el estado actual. Actualizá e intentá de nuevo.";
    case "invalid_input":
      return "Revisá los datos e intentá de nuevo.";
    case "unauthenticated":
      return "Tu sesión venció. Volvé a ingresar.";
    case "rate_limited":
      return "Hiciste muchos intentos. Esperá un momento y volvé a probar.";
    default:
      return "No pudimos completar el cambio. Intentá de nuevo.";
  }
}
