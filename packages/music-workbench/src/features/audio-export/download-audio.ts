/** 触发一次可撤销的本地下载，不把导出 Blob 或 Object URL 写入持久化状态。 */
import { getWorkbenchRuntime } from '../../runtime/workbench-runtime'

export async function downloadAudioBlob(
  blob: Blob,
  title: string,
  extension: string,
): Promise<string> {
  const fileName = createAudioDownloadFileName(title, extension)
  await downloadBlob(blob, fileName)
  return fileName
}

/** 所有浏览器保存动作都走同一入口，批量 ZIP 因而只会触发一次点击。 */
export async function downloadBlob(blob: Blob, fileName: string) {
  const save = getWorkbenchRuntime().saveBlob
  if (save) return save(blob, fileName)
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

/** 文件名规范独立出来，下载历史与浏览器保存动作使用完全相同的名称。 */
export function createAudioDownloadFileName(title: string, extension: string): string {
  const safeTitle =
    title
      .normalize('NFKC')
      .replace(/[<>:"/\\|?*]/g, '_')
      .split('')
      .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
      .join('')
      .trim() || 'any-music-export'
  return `${safeTitle}.${extension}`
}
