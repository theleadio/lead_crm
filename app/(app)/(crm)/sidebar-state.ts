// The CRM sidebar's open/closed choice lives in a cookie, not localStorage,
// so the server renders the right width on the first paint and the layout
// does not jump after hydration.
export const SIDEBAR_COOKIE = "crm_sidebar";
export const SIDEBAR_COLLAPSED = "collapsed";
