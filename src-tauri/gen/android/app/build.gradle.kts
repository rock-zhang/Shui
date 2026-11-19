import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

// 只有下载了 google-services.json 才启用 Firebase 插件：
// 缺少配置时（本地开发 / CI 未注入）项目仍可正常编译，AnalyticsTracker
// 会在运行时检测不到 FirebaseApp 并整体降级为 no-op。
val hasFirebaseConfig = file("google-services.json").exists()
if (hasFirebaseConfig) {
    apply(plugin = "com.google.gms.google-services")
    apply(plugin = "com.google.firebase.crashlytics")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release 签名：优先读环境变量（CI 从 secrets 注入 keystore），其次读
// gen/android/key.properties（Android Studio 本地发布）。两者都没有时回退
// debug 签名，保证本机能打出可安装的测试包；上架必须由 CI 强制校验签名。
val signingProperties = Properties().apply {
    val propFile = rootProject.file("key.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

fun signingValue(key: String, env: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() }
        ?: signingProperties.getProperty(key)?.takeIf { it.isNotBlank() }

val releaseStoreFile = signingValue("storeFile", "ANDROID_KEYSTORE_FILE")
val releaseStorePassword = signingValue("storePassword", "ANDROID_KEYSTORE_PASSWORD")
val releaseKeyAlias = signingValue("keyAlias", "ANDROID_KEY_ALIAS")
val releaseKeyPassword = signingValue("keyPassword", "ANDROID_KEY_PASSWORD")
val hasReleaseSigning = releaseStoreFile != null && releaseStorePassword != null &&
    releaseKeyAlias != null && releaseKeyPassword != null

android {
    // AGP 9.3 要求 compileSdk >= 36；这里跟模板取 37。
    compileSdk = 37
    namespace = "com.shui.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.shui.app"
        minSdk = 24
        // 已按 Android 15+ 的强制 edge-to-edge 改造完成（见 MainActivity 的
        // enableEdgeToEdge 与 ReminderPlugin.applySystemBarTheme 的窗口背景）。
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
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
            // Tauri 的 Kotlin 插件通过反射实例化；首个 Android 测试包先关闭 R8，
            // 避免混淆把 ReminderPlugin / BroadcastReceiver 裁掉。
            isMinifyEnabled = false
            signingConfig = if (hasReleaseSigning) {
                signingConfigs.getByName("release")
            } else {
                // debug 签名只用于本地自测，Play 会拒绝；CI 打包流程会拦截。
                signingConfigs.getByName("debug")
            }
        }
    }
    buildFeatures {
        buildConfig = true
    }
    // AGP 9 把 Java 默认 target 抬到 11，Kotlin 必须跟着对齐，否则
    // compileUniversalDebugKotlin 会因 JVM-target 不一致直接失败。
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    // AGP 9 的 lintVital 与 Kotlin 2.2 的 FIR 分析器不兼容，release 构建会
    // 在 lintVitalAnalyzeUniversalRelease 崩溃（findFirCompiledSymbol 报
    // "declaration is not compiled"，lint 自报是自身 bug）。lint 只做静态
    // 检查、不参与产物生成，关闭 release 阶段的 vital 检查不影响 APK/AAB；
    // 需要体检时可单独跑 ./gradlew lintDebug。
    lint {
        checkReleaseBuilds = false
    }
}

// Kotlin 2.2 移除了 `android.kotlinOptions`，jvmTarget 改由 Kotlin DSL 配置。
kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_11
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    // 版本跟随 Tauri 2.12 CLI 生成的模板；tauri-android 2.12 依赖
    // activity-ktx 1.10 / lifecycle 2.10，旧版本会因 API 缺失编译失败。
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // Firebase：版本由 BOM 统一管理；没有 google-services.json 时
    // FirebaseApp 不会初始化，AnalyticsTracker 会自动跳过上报。
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation("com.google.firebase:firebase-crashlytics")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
