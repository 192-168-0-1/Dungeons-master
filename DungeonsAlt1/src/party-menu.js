export const PARTY_CONTEXT_OPTIONS = Object.freeze(["Inspect", "Kick", "Promote", "Cancel"]);

export function clampContextMenuPosition(x, y, width, height, viewportWidth, viewportHeight, padding = 2) {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const safeViewportWidth = Math.max(safeWidth + padding, Number(viewportWidth) || 0);
  const safeViewportHeight = Math.max(safeHeight + padding, Number(viewportHeight) || 0);
  return {
    x: Math.max(padding, Math.min(Math.round(Number(x) || 0), safeViewportWidth - safeWidth - padding)),
    y: Math.max(padding, Math.min(Math.round(Number(y) || 0), safeViewportHeight - safeHeight - padding)),
  };
}
