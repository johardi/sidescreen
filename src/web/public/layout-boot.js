/**
 * Applies the remembered workspace layout before the body is laid out.
 *
 * Loaded as a blocking script in the head, so the first frame already has
 * the user's pane widths and hidden sidebar, and a reload performed by
 * following shows no jump. An inline script cannot do this: the page's
 * content security policy allows scripts from its own origin only.
 *
 * The limits repeat the ones in layout.js on purpose. This file has to run
 * before any module can load, so it cannot import them.
 */
(() => {
  const STORAGE_KEY = 'sidescreen:layout';
  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX = 480;
  const THREAD_MIN = 260;
  const RAIL = 40;

  /**
   * @param {unknown} value
   * @returns {value is number}
   */
  const isWidth = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;
    const stored = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null) return;
    const root = document.documentElement;
    if (stored.sidebarHidden === true) {
      root.setAttribute('data-sidebar-hidden', '');
      root.style.setProperty('--sidebar-column', `${RAIL}px`);
      root.style.setProperty('--handle-column', '0px');
    } else if (isWidth(stored.sidebarWidth)) {
      root.style.setProperty('--sidebar-column', `${Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(stored.sidebarWidth)))}px`);
    }
    if (isWidth(stored.threadWidth)) {
      root.style.setProperty('--thread-column', `${Math.max(THREAD_MIN, Math.round(stored.threadWidth))}px`);
    }
    if (stored.theme === 'light' || stored.theme === 'dark') root.setAttribute('data-theme', stored.theme);
    if (stored.composer === 'minimized' || stored.composer === 'open' || stored.composer === 'maximized') root.setAttribute('data-composer', stored.composer);
  } catch {
    // No storage, or a record this version does not understand: the defaults apply.
  }
})();
