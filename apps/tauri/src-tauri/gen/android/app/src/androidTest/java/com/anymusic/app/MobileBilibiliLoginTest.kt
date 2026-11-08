package com.anymusic.app

import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileBilibiliLoginTest {
    private val key = "0123456789abcdef0123456789abcdef"
    private val account = "https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=$key&from="
    private val passport = "https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=$key&from="
    private fun handoff(target: String) = Uri.parse("bilibili://browser/").buildUpon()
        .appendQueryParameter("url", target).build().toString()

    @Test fun both_official_scan_routes_reach_the_implicit_app_intent() {
        for (url in listOf(account, passport)) {
            val link = handoff(url)
            val intent = bilibiliLoginIntent(link)!!
            assertEquals(Intent.ACTION_VIEW, intent.action)
            assertTrue(intent.hasCategory(Intent.CATEGORY_BROWSABLE))
            assertEquals(link, intent.data.toString())
            assertEquals(url, intent.data!!.getQueryParameter("url"))
            assertNull(intent.`package`)
            assertNull(intent.component)
        }
    }

    @Test fun unrelated_pages_and_ambiguous_challenges_are_rejected() {
        for (url in listOf(
            "https:opaque",
            account.replace("account.bilibili.com", "evil.example"),
            account.replace("account.bilibili.com", "passport.bilibili.com"),
            passport.replace("passport.bilibili.com", "account.bilibili.com"),
            account.replace("account.bilibili.com", "account.bilibili.com.evil.example"),
            account.replace("account.bilibili.com", "user@account.bilibili.com"),
            account.replace("account.bilibili.com", "account.bilibili.com:443"),
            account.replace("https:", "http:"),
            account.replace("/auth/scan-web", "/auth/other"),
            "$account&qrcode_key=$key",
            "$account#fragment",
            account.replace(key, "invalid"),
            account.replace("qrcode_key=$key", "missing=key"),
        )) assertNull(url, bilibiliLoginIntent(handoff(url)))
    }

    @Test fun chooser_preserves_an_independent_temporary_authorization_task() {
        for (url in listOf(account, passport)) {
            val chooser = Intent.createChooser(bilibiliLoginIntent(handoff(url))!!, "选择哔哩哔哩应用")
            @Suppress("DEPRECATION")
            val target = chooser.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)!!
            assertEquals(Intent.FLAG_ACTIVITY_NEW_DOCUMENT or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or
                Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS, target.flags)
            // The authorizer must remain alive through any nested login or verification UI.
            assertEquals(0, target.flags and Intent.FLAG_ACTIVITY_NO_HISTORY)
            assertEquals(url, target.data!!.getQueryParameter("url"))
            assertNull(target.`package`)
            assertNull(target.component)
        }
    }

    @Test fun malformed_outer_links_cannot_launch_arbitrary_intents() {
        val link = handoff(account)
        for (value in listOf(
            "bilibili://browser/",
            "https://example.com/",
            link.replace("bilibili:", "intent:"),
            link.replace("browser/", "other/"),
            link.replace("browser/", "user@browser/"),
            link.replace("browser/", "browser:80/"),
            "$link&url=${Uri.encode(passport)}",
            "$link&extra=1",
            "$link#fragment",
            link + "a".repeat(8192),
        )) assertNull(bilibiliLoginIntent(value))
    }
}
