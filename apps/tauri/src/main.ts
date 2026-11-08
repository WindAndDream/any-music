import { invoke } from '@tauri-apps/api/core'
import { createPinia } from 'pinia'
import '@any-music/ui/styles'

import './styles/app.scss'
import { createApp } from 'vue'

import App from './App.vue'
import { protectedStyles } from './features/plugins/built-in-themes'
import { configureTauriWorkbench } from './platform/configure-tauri-workbench'

document.addEventListener('click', (event) => {
  const link = event
    .composedPath()
    .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
  if (link?.href && /^https?:/.test(link.href) && !link.href.startsWith('http://127.0.0.1:')) {
    event.preventDefault()
    void invoke('open_external', { url: link.href }).catch(() =>
      window.dispatchEvent(new CustomEvent('any-music:external-error')),
    )
  }
})

try {
  const hostStyle = document.createElement('style')
  hostStyle.dataset.amHostStyles = ''
  hostStyle.textContent = protectedStyles
  document.head.append(hostStyle)
  await configureTauriWorkbench()
  createApp(App).use(createPinia()).mount('#app')
} catch (error) {
  const target = document.getElementById('app')
  if (target) {
    target.textContent = `Any Music 启动失败：${String(error)}`
    const button = document.createElement('button')
    button.textContent = '重试'
    button.addEventListener('click', () => location.reload())
    target.append(button)
  }
}
