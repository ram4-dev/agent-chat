import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { Button, Field } from "../../apps/web/src/shared/ui";

// Resolve React through the workspace that owns it; the root is not a web application.
const webRequire = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createElement } = webRequire("react") as {
  createElement(
    component: unknown,
    props: object,
    ...children: unknown[]
  ): unknown;
};
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  renderToStaticMarkup(node: unknown): string;
};

describe("shared native UI composition", () => {
  it("keeps disabled, accessible name and non-submit semantics on icon buttons", () => {
    const html = renderToStaticMarkup(
      createElement(
        Button,
        { size: "icon", "aria-label": "Cerrar", disabled: true },
        "×",
      ),
    );
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Cerrar"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('class="icon-button');
  });
  it("associates a field label and hint with its control", () => {
    const html = renderToStaticMarkup(
      createElement(Field, {
        label: "Nombre",
        hint: "Como te reconoce el equipo.",
        children: (props: { id: string }) =>
          createElement("input", { ...props, required: true }),
      }),
    );
    const id = html.match(/<input id="([^"]+)"/)![1]!;
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain(`aria-describedby="${id}-hint"`);
    expect(html).toContain(`id="${id}-hint"`);
    expect(html).toContain('required=""');
  });
});
