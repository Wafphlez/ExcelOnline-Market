/// <reference types="vite/client" />

interface ImportMetaEnv
{
  readonly VITE_EVE_SSO_CLIENT_ID?: string
  /** Полный callback URL, если нельзя использовать origin+pathname (по умолчанию) */
  readonly VITE_EVE_SSO_REDIRECT_URI?: string
}

interface ImportMeta
{
  readonly env: ImportMetaEnv
}
