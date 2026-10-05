plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.github.dreamtheater484.memora"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "io.github.dreamtheater484.memora"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.10.0-trial"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            // The trial is signed with the debug key; a release would have its own.
            signingConfig = signingConfigs.getByName("debug")
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
