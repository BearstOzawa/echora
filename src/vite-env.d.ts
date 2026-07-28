/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ECHORA_CLOUD_URL?: string
}

interface ImportMetaEnv {
  readonly VITE_ECHORA_UI_PLATFORM?: 'desktop' | 'mobile'
  readonly VITE_ECHORA_UPDATE_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __ECHORA_VERSION__: string
declare const __ECHORA_BUILD_ID__: string
