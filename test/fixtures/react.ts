// Minimal stand-in for React (Hyper provides the real one at runtime).
export class PureComponent<P = any> {
  props: P;

  constructor(props: P) {
    this.props = props;
  }
}

export function createElement(type: any, props: any, ...children: any[]) {
  return { type, props, children };
}

export default { PureComponent, createElement };
