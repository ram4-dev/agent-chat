import { Children, isValidElement, memo, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './chat.css';

export function safeMessageUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child =>
    typeof child === 'string' || typeof child === 'number' ? String(child)
      : isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : '',
  ).join('');
}
function CopyableCode({ children }: { children?: ReactNode }) {
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  return <div className="chat-code-block">
    <button type="button" aria-label="Copiar código" onClick={async () => {
      clearTimeout(timer.current);
      try { await navigator.clipboard.writeText(textContent(children).replace(/\n$/, '')); setStatus('Copiado'); }
      catch { setStatus('No se pudo copiar. Seleccioná el código para copiarlo.'); }
      timer.current = setTimeout(() => setStatus(''), 3000);
    }}>Copiar código</button>
    <span role="status" className="chat-copy-status">{status}</span>
    <pre tabIndex={0} aria-label="Bloque de código">{children}</pre>
  </div>;
}

/** Safe reusable renderer: no HTML plugins, remote images or active URL schemes. */
export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  return <div className="chat-markdown"><ReactMarkdown
    remarkPlugins={[remarkGfm]}
    urlTransform={safeMessageUrl}
    components={{
      a: ({ href, children }) => href
        ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
        : <span>{children}</span>,
      img: ({ alt }) => <span>{alt}</span>,
      pre: ({ children }) => <CopyableCode>{children}</CopyableCode>,
    }}
  >{text}</ReactMarkdown></div>;
});
