/// <reference types="vite/client" />
declare module '@any-music/ui/styles'

declare module '@any-music/theme-default/styles'

declare module 'virtual:any-music-theme-styles/*' {
  const css: string
  export default css
}
