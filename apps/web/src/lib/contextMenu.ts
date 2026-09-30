/**
 * Opens the right-click menu of the element `button` sits in, just below the button, as a
 * right-click there would. "…" buttons use it to show a row's menu without a second copy of it.
 */
export function openContextMenu(button: HTMLElement) {
  const box = button.getBoundingClientRect();
  button.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: box.left,
      clientY: box.bottom,
    }),
  );
}
