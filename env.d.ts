/**
 * 所有 Vite 应用共享的公开环境变量契约。
 * VITE_ 变量会进入客户端产物，因此这里只允许声明可公开的构建配置。
 */
interface ImportMetaEnv {
  readonly VITE_APP_ENV: 'dev' | 'staging' | 'prod'
  readonly VITE_APP_DEBUG: 'true' | 'false'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
