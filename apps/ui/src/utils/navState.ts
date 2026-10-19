/**
 * Remembers *how* the last navigation happened. Browsing pages restore their scroll position and the
 * focused card only when the user came back (Back button, Alt+Left, Esc) and not when they opened the
 * page fresh from the sidebar. vue-router tells scrollBehavior about a back/forward move through
 * `savedPosition`; the router records it here.
 */
export const navState = { arrivedByHistory: false }
