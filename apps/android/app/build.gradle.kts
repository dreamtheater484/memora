import groovy.json.JsonSlurper
import java.nio.file.Files
import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Memora's version, from the root package.json as everywhere else (docs/RELEASING.md).
val memoraVersion = (JsonSlurper().parse(rootProject.file("../../package.json")) as Map<*, *>)["version"] as String

/**
 * Android's versionCode for a Memora version: MAJOR × 10,000,000 + MINOR × 10,000 + PATCH × 10,
 * plus 9 for a release, or N − 1 for its candidate -rc.N. Android installs an APK over another
 * only with a higher code, so it rises with every version (docs/RELEASING.md). The same rule as
 * androidVersionCode in scripts/release-notes.mjs, which the Android workflow checks against.
 */
fun versionCodeOf(version: String): Int {
    val match = Regex("""(\d+)\.(\d+)\.(\d+)(?:-rc\.([1-9]))?""").matchEntire(version)
        ?: throw GradleException("Android can't number $version: a pre-release must be -rc.1 to -rc.9 (docs/RELEASING.md)")
    val (major, minor, patch) = match.groupValues.subList(1, 4).map { it.toInt() }
    if (major > 209 || minor > 999 || patch > 999) {
        throw GradleException("Android can't number $version: at most 209.999.999 (docs/RELEASING.md)")
    }
    val rc = match.groupValues[4]
    return major * 10_000_000 + minor * 10_000 + patch * 10 + if (rc.isEmpty()) 9 else rc.toInt() - 1
}

// Releases are signed with Memora's own key (docs/SIGNING.md#android): Android installs an APK
// over another only when the same key signed both. The key comes from four environment variables.
// Without any of them, a build is signed with this machine's debug key, and its APKs' names say
// so: they install over no other build. With -Pmemora.release=true (the release workflow), a
// missing key fails the build instead.
fun env(name: String): String? = System.getenv(name)?.takeIf { it.isNotBlank() }

val missingKey = listOf("ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD").filter { env(it) == null } +
    listOfNotNull(
        "ANDROID_KEYSTORE_BASE64 (or ANDROID_KEYSTORE_PATH)"
            .takeIf { env("ANDROID_KEYSTORE_BASE64") == null && env("ANDROID_KEYSTORE_PATH") == null },
    )
val releaseKey = missingKey.isEmpty()
val isRelease = providers.gradleProperty("memora.release").orNull == "true"
if (!releaseKey && (isRelease || missingKey.size < 4)) {
    throw GradleException(
        "Signing with Memora's key needs ${missingKey.joinToString()} (docs/SIGNING.md#android)." +
            if (isRelease) " A release is never signed with the debug key: no release could install over it." else "",
    )
}

/** The keystore: decoded from ANDROID_KEYSTORE_BASE64 into a temporary file, or at ANDROID_KEYSTORE_PATH. */
fun keystoreFile(): File {
    env("ANDROID_KEYSTORE_BASE64")?.let { base64 ->
        // Outside the repository, readable by this user only, and deleted when Gradle exits.
        return Files.createTempFile("memora-release", ".jks").toFile().apply {
            deleteOnExit()
            writeBytes(Base64.getMimeDecoder().decode(base64))
        }
    }
    return file(env("ANDROID_KEYSTORE_PATH")!!).also {
        if (!it.isFile) throw GradleException("ANDROID_KEYSTORE_PATH: there's no keystore at $it")
    }
}

android {
    namespace = "io.github.dreamtheater484.memora"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "io.github.dreamtheater484.memora"
        minSdk = 26
        targetSdk = 35
        versionCode = versionCodeOf(memoraVersion)
        versionName = memoraVersion
    }

    signingConfigs {
        if (releaseKey) {
            create("memora") {
                storeFile = keystoreFile()
                storePassword = env("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = env("ANDROID_KEY_ALIAS")
                keyPassword = env("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.getByName(if (releaseKey) "memora" else "debug")
        }
    }

    // One APK per processor type: Node.js is the largest part, and each phone needs one build.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "x86_64")
            isUniversalApk = false
        }
    }

    packaging {
        // Node.js runs as a program, so it must be a file on the phone: Android extracts the
        // libraries from the APK into the app's library folder, the one place it may run from.
        jniLibs.useLegacyPackaging = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

// `./gradlew apks`: the release APKs in app/build/apks, named as on the release page:
// Memora-<version>-arm64.apk for phones, and Memora-<version>-x86_64.apk. Signed with the debug
// key, they're Memora-<version>-arm64-debug-key.apk.
tasks.register<Sync>("apks") {
    group = "build"
    description = "Builds the release APKs, named as on the release page."
    dependsOn("assembleRelease")
    val archs = mapOf("arm64-v8a" to "arm64", "x86_64" to "x86_64")
    val suffix = if (releaseKey) "" else "-debug-key"
    val signedWith = if (releaseKey) "Memora's key" else "this machine's debug key: for testing only, they install over no other build"
    from(layout.buildDirectory.dir("outputs/apk/release")) { include("*.apk") }
    into(layout.buildDirectory.dir("apks"))
    rename { name ->
        val abi = Regex("""app-(.+)-release\.apk""").matchEntire(name)?.groupValues?.get(1)
        val arch = abi?.let { archs[it] } ?: throw GradleException("apks: an APK for no known processor: $name")
        "Memora-$memoraVersion-$arch$suffix.apk"
    }
    doLast { logger.lifecycle("Memora $memoraVersion, signed with $signedWith.") }
}
