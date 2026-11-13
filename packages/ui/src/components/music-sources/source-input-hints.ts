export interface MusicSourceInputHints {
  searchPlaceholder: string
  importPlaceholder: string
}

/** 平台提示只影响输入说明；URL 识别仍由对应音乐源插件负责。 */
export function getMusicSourceInputHints(pluginId: string): MusicSourceInputHints {
  if (pluginId === 'bilibili') {
    return {
      searchPlaceholder: '歌曲、UP 主或关键词',
      importPlaceholder: '合集 / UP 投稿 / 收藏夹 / 视频 URL',
    }
  }
  if (pluginId === 'douyin') {
    return {
      searchPlaceholder: '歌曲、作者或关键词',
      importPlaceholder: '推荐 / 喜欢 / 收藏 / 合集 / 视频 URL',
    }
  }
  if (pluginId === 'netease') {
    return {
      searchPlaceholder: '歌曲、歌手或关键词',
      importPlaceholder: '网易云歌曲 / 歌单 / 专辑 / 歌手 URL',
    }
  }
  return {
    searchPlaceholder: '歌曲、作者或关键词',
    importPlaceholder: '可识别的音乐内容 URL',
  }
}
