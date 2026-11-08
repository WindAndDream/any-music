package com.anymusic.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Engine-floor tests are native-only. The live harness drives the actual Tauri
 * process externally; instrumentation teardown must not destroy its native loop. */
@RunWith(AndroidJUnit4::class)
class MobileWorkbenchTest {
    @Test fun the_engine_floor_rejects_missing_malformed_or_older_providers() {
        for (version in listOf(null, "", "unknown", "110.0.0.0", "-1", "999999999999")) assertFalse(MobileWebViewSupport.supported(version))
        for (version in listOf("111.0.0.0", "113.0.5672.136", "150.0.0.0")) assertTrue(MobileWebViewSupport.supported(version))
    }
}
