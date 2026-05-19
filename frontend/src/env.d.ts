/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module "*.svg?component" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent;
  export default component;
}
