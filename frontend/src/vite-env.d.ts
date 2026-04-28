/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_TARGET?: string;
  readonly VITE_BASENAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
