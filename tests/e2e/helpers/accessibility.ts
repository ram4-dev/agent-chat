import { expect, type Locator, type Page } from "@playwright/test";

/** Check rendered controls, including password inputs without an implicit role. */
export async function expectNamedControls(
  scope: Page | Locator,
): Promise<void> {
  const controls = scope.locator(
    'button:visible, input:not([type="hidden"]):visible, textarea:visible, select:visible, summary:visible',
  );
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    await expect(control).toHaveAccessibleName(/\S/);
  }
}

/** Check the control or its enclosing field's rendered keyboard focus cue. */
export async function expectVisibleKeyboardFocus(
  page: Page,
  control: Locator,
  indicator: Locator = control,
): Promise<void> {
  const appearance = () =>
    indicator.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outline:
          style.outlineStyle !== "none" &&
          Number.parseFloat(style.outlineWidth) > 0,
        shadow: style.boxShadow,
        border: style.borderColor,
        hasBorder:
          style.borderStyle !== "none" &&
          Number.parseFloat(style.borderWidth) > 0,
      };
    });
  await control.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const unfocused = await appearance();
  await control.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  await expect(indicator).toBeVisible();
  await expect
    .poll(() =>
      control.evaluate((element) => element.matches(":focus-visible")),
    )
    .toBe(true);
  await expect
    .poll(async () => {
      const focused = await appearance();
      return (
        focused.outline ||
        (focused.shadow !== "none" && focused.shadow !== unfocused.shadow) ||
        (focused.hasBorder && focused.border !== unfocused.border)
      );
    })
    .toBe(true);
}
