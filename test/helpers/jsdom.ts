/* jsdom does not implement window.focus(); calling it spams "Not
   implemented: window.focus" on stderr from every test that triggers a
   viewTab(). Hyper's window does have focus(), so stub it as a no-op
   instead of letting jsdom log a virtual-console error. */
if (typeof window !== 'undefined') {
  window.focus = () => undefined;
}
