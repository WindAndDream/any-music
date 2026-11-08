/// <reference types="vite/client" />
/// <reference types="vite-plugin-monkey/client" />
/// <reference types="vite-plugin-monkey/style" />

// 为 Vite 环境变量、资源查询和 vite-plugin-monkey 的虚拟 `$` 模块提供全局类型。

declare module 'virtual:any-music-theme-styles/*' {
  const css: string
  export default css
}
