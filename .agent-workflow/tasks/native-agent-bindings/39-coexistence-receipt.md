# Coexistencia de sesiones interactivas y receptor automático

Solicitud: continuar el siguiente pendiente sin profiles, credenciales ni decisiones externas, verificando y corrigiendo. Se elige el escenario explícito S6 de escritura interactiva durante un job automático activo, sin alterar claims/inbox ni duplicar auditoría. Las pruebas previas cubrían inbox pendiente, no el turno iniciado.

Fuente: feat/codex-native-controls,d51cf92, limpia. Worktrunk creó feat/native-coexistence en /Users/ramiro/Desktop/projects/agent_chat.feat-native-coexistence. Fuente/main preservados; dependencias con lockfile. Se conserva el worktree para revisión.

Alcance: fixtures locales de identidades, conexiones y proveedor simulado. No modificaciones a implementación OAuth ni conexiones personales, sin ~/.hermes, modelos/mensajes reales, push o PR. Cualquier defecto confirmado de coexistencia se corrige con regresión. S6 automático y las aceptaciones reales siguen pendientes; no se les atribuye éxito por estos tests.
