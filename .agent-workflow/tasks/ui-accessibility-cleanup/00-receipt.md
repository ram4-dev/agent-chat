# Accesibilidad básica y limpieza del rediseño

Fecha: 2026-10-23. Rama: `feat/ui-redesign`. Base: `fcd94e5`.
Repositorio: `/Users/ramiro/Desktop/projects/agent_chat`.
Worktree reutilizado por pedido explícito del usuario:
`/Users/ramiro/Desktop/projects/agent_chat.feat-ui-redesign`.
El checkout principal y los otros worktrees no se modificaron.

## Cambios

- Tres E2E nuevos para acceso, conversaciones e invitaciones, y agentes en móvil.
  Verifican nombres accesibles de botones, inputs (también contraseñas), selects
  y summaries; roles, relaciones ARIA, selección y foco inicial de diálogos.
- Navegación Tab/Shift+Tab con comprobación del indicador visual del control o
  su contenedor. El compositor y el campo de copia dibujan el foco en su marco.
- Atributos de selección y relación pestaña-panel en acceso; `aria-modal` en los
  diálogos; relaciones y estado expandido de navegación y detalles.
- Un contenedor de marcado conserva el tamaño intrínseco del encabezado de
  agentes. El E2E móvil detectó que el contenido podía tapar sus acciones después
  de crear un agente. El test conserva el clic real en Conectar cliente.
- Eliminados los helpers heredados `createGroup`, `acceptInvitation`,
  `removeMember`, `describeMember`, `post` y `logout`, su tipo `ActionResult`,
  reexports de tipos del transporte y seis tests exclusivos de esas rutas muertas.
  La creación, admisión, autoría y cierre de sesión actuales siguen cubiertos por
  las suites de integración y E2E; el nuevo check también cierra una sesión real.
- Eliminados la variante sin consumidores `Modal.wide`, `.modal-wide`,
  `--radius` y dos traducciones de códigos no emitidos por los contratos actuales.
- README con arranque local, preparación de Chromium, comandos por suite,
  checks de accesibilidad y la limitación pendiente de menciones semánticas.

No se modificaron handlers de la aplicación ni del backend, lógica de negocio,
estilos activos, APIs, permisos, persistencia ni funcionalidades de menciones.

## Límite observado

Al desmontar un diálogo, el foco no siempre vuelve al botón de apertura. Se
retiró esa aserción adicional del check básico y se documentó el pendiente en el
README. Resolverlo requiere cambiar el ciclo de vida de Modal, fuera del alcance
solicitado de atributos y marcado. Los checks sí validan foco visible navegando
con teclado e ingreso del foco al diálogo.

Las dos aserciones iniciales se ajustaron al marcado real: una lista vacía puede
medir cero píxeles, y el foco del compositor/campo de copia se ve en sus marcos.
No se agregaron esperas fijas ni se forzaron clics para ocultar el solapamiento.

## Verificación

`pnpm verify` completo con Node.js 22.23.3:

- Lint, typecheck y build: aprobados.
- Unitarios: 142; contratos: 15; integración: 117. Total: 274.
- Chromium E2E: 20, incluidos los tres nuevos de accesibilidad.
- `git diff --check`: aprobado.

La cantidad unitaria baja de 148 a 142 por los seis tests de helpers eliminados.
La revisión se conserva en este worktree. Sin push ni PR.
