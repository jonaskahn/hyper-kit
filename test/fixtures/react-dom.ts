// Minimal stand-in for react-dom (Hyper provides the real one at runtime).
export function findDOMNode(): null {
  return null;
}

export default { findDOMNode };
