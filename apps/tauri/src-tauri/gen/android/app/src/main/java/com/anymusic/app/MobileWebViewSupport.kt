package com.anymusic.app

/** Product ES2022/CSS bootstrap floor, separate from plugin isolation/admission. */
internal object MobileWebViewSupport {
    const val MINIMUM_MAJOR = 111
    fun supported(version: String?): Boolean =
        version?.substringBefore('.')?.toIntOrNull()?.let { it >= MINIMUM_MAJOR } ?: false
}
