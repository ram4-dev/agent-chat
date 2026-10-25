/* global document, window, navigator, setTimeout, clearTimeout */
const status = document.querySelector(".copy-status");
let announcement;
document.querySelectorAll("[data-copy]").forEach((button) => {
  button.hidden = false;
  button.addEventListener("click", async () => {
    const example = document.getElementById(button.dataset.copy);
    if (!example) return;
    clearTimeout(announcement);
    status.textContent = "";
    try {
      await navigator.clipboard.writeText(example.textContent);
      button.textContent = "Copiado";
      announcement = setTimeout(() => {
        status.textContent = "Ejemplo copiado.";
      }, 50);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(example);
      selection?.removeAllRanges();
      selection?.addRange(range);
      example.focus();
      button.textContent = "Copiar";
      announcement = setTimeout(() => {
        status.textContent =
          "No pudimos copiar. Seleccioná y copiá el ejemplo.";
      }, 50);
    }
  });
});
