import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
val adapterTests = providers.environmentVariable("AM_ANDROID_ADAPTER_TEST").orNull == "1"
val audioProbeTests = providers.environmentVariable("AM_ANDROID_AUDIO_PROBE").orNull == "1"
check(!audioProbeTests || adapterTests) { "The audio probe requires the isolated adapter build" }

android {
    ndkVersion = tauriProperties.getProperty("tauri.android.ndkVersion", "30.0.16248370")
    buildToolsVersion = tauriProperties.getProperty("tauri.android.buildToolsVersion", "36.0.0")
    compileSdk = 37
    namespace = "com.anymusic.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        // A separately identified native test host never replaces the user's product.
        applicationId = if (audioProbeTests) "com.anymusic.audioprobe" else if (adapterTests)
            "com.anymusic.adaptertest" else "com.anymusic.app"
        // Current Tauri/Jackson uses java.lang.BootstrapMethodError (API 26).
        minSdk = 26
        // Only the separate focus probe may request focus while the product stays top/resumed.
        targetSdk = if (audioProbeTests) 34 else 37
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    sourceSets {
        // Only the matching profile receives JNI output from the locked Cargo build.
        getByName("main").jniLibs.setSrcDirs(emptyList<String>())
        getByName("androidTest").assets.srcDir(file("build/generated/s16-assets"))
        if (adapterTests) {
            if (audioProbeTests) getByName("debug").java.srcDir("src/audioProbe/java")
            getByName("debug").jniLibs.setSrcDirs(emptyList<String>())
            getByName("debug").manifest.srcFile(if (audioProbeTests)
                "src/audioProbe/AndroidManifest.xml" else "src/adapterTest/AndroidManifest.xml")
        }
    }
    val signedRelease = providers.environmentVariable("AM_ANDROID_SIGNED_BUILD").orNull == "1"
    if (signedRelease) {
        signingConfigs {
            create("localRelease") {
                fun required(name: String): String = providers.environmentVariable("AM_ANDROID_$name")
                    .orNull?.takeIf { it.isNotBlank() } ?: error("AM_ANDROID_$name is required")
                storeFile = file(required("KEYSTORE"))
                storePassword = required("STORE_PASSWORD")
                keyAlias = required("KEY_ALIAS")
                keyPassword = required("KEY_PASSWORD")
                check(keyAlias != "androiddebugkey") { "Release signing cannot use the debug key alias" }
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isDebuggable = false
            isJniDebuggable = false
            if (signedRelease) signingConfig = signingConfigs.getByName("localRelease")
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test:runner:1.5.2")
    androidTestImplementation("androidx.test:core:1.5.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
