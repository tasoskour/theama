/// <reference types="vite/client" />
import type { TheamaBridge } from '@theama/contracts'

declare global {
  interface Window {
    /** Exposed by the Electron preload script; absent in a plain browser. */
    theama?: TheamaBridge
  }
  interface ImportMetaEnv {
    /** Dev-only: API base for running the UI in a plain browser. */
    readonly VITE_API_BASE?: string
    readonly VITE_API_TOKEN?: string
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
