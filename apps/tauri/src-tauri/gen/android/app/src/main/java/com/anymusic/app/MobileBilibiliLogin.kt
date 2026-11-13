package com.anymusic.app

import android.content.Intent
import android.net.Uri

/** Mirrors the native QR handoff boundary; both official scan routes use the app browser. */
internal fun bilibiliLoginIntent(link: String): Intent? {
    if (link.length > 8192) return null
    val uri = Uri.parse(link)
    if (uri.scheme != "bilibili" || uri.encodedAuthority != "browser" || uri.path != "/" ||
        uri.fragment != null || uri.queryParameterNames != setOf("url")) return null
    val targets = uri.getQueryParameters("url")
    if (targets.size != 1) return null
    val target = Uri.parse(targets.single())
    if (target.scheme != "https" || target.userInfo != null || target.port != -1 ||
        target.fragment != null) return null
    // The QR service now returns account.bilibili.com; do not mix hosts and paths.
    val scanPage = when (target.encodedAuthority) {
        "account.bilibili.com" -> target.path == "/h5/account-h5/auth/scan-web"
        "passport.bilibili.com" -> target.path == "/h5-app/passport/login/scan"
        else -> false
    }
    if (!scanPage) return null
    val keys = target.getQueryParameters("qrcode_key")
    if (keys.size != 1 || !keys.single().matches(Regex("[0-9a-fA-F]{32}"))) return null
    // The official scan page calls global.closeBrowser after confirmation. Give
    // that browser a fresh document task so closing it returns to our caller,
    // instead of revealing Bilibili's existing home/activity stack. Keep the
    // temporary task out of Recents and resolution implicit for app clones.
    return Intent(Intent.ACTION_VIEW, uri)
        .addCategory(Intent.CATEGORY_BROWSABLE)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or
            Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
}
