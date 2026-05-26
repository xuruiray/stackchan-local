/// <reference types="vite/client" />

import type { JSX as ReactJSX, ReactElement } from "react";

declare global {
  namespace JSX {
    type Element = ReactElement;
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}
