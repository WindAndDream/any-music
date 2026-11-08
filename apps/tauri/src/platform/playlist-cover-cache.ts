import { createPlaylistCoverCache } from '@any-music/music-workbench/storage'

/** Local artwork has its own database so thumbnails cannot exhaust the product mirror's quota. */
export function createTauriPlaylistCoverCache() {
  function transaction(mode: IDBTransactionMode, value?: Record<string, string>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let abandoned = false
      const opening = indexedDB.open('any-music:tauri:playlist-covers:v1', 1)
      opening.onupgradeneeded = () => {
        opening.result.createObjectStore('covers')
      }
      opening.onerror = () => reject(opening.error)
      opening.onblocked = () => {
        abandoned = true
        reject(new Error('歌单封面存储被其他窗口占用，请关闭其他窗口后重试。'))
      }
      opening.onsuccess = () => {
        const database = opening.result
        if (abandoned) {
          database.close()
          return
        }
        database.onversionchange = () => database.close()
        try {
          const current = database.transaction('covers', mode)
          const store = current.objectStore('covers')
          const request = mode === 'readonly' ? store.get('entries') : store.put(value, 'entries')
          let result: unknown
          request.onsuccess = () => {
            result = request.result
          }
          current.oncomplete = () => {
            database.close()
            resolve(result)
          }
          current.onabort = current.onerror = () => {
            database.close()
            reject(current.error ?? request.error)
          }
        } catch (cause) {
          database.close()
          reject(cause)
        }
      }
    })
  }
  return createPlaylistCoverCache({
    read: () => transaction('readonly'),
    write: async (value) => {
      await transaction('readwrite', value)
    },
  })
}
