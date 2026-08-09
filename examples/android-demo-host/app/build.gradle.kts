import org.gradle.api.tasks.Sync
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val supportedRuntimeAbis = setOf("arm64-v8a", "x86_64")
val runtimeAbis = providers.gradleProperty("runeweaveAbis").orElse(supportedRuntimeAbis.joinToString(","))
val requestedRelease = gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }
val runtimeProfile = if (requestedRelease) "release" else "debug"
val runtimeDist = rootProject.layout.projectDirectory.dir("../../dist/runtimes/android")
val rustJniLibs = layout.buildDirectory.dir("generated/rustJniLibs")

android {
    namespace = "io.github.super1windcloud.runeweave.demo"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.super1windcloud.runeweave.demo"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    sourceSets["main"].jniLibs.srcDir(rustJniLibs)
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin.compilerOptions.jvmTarget.set(JvmTarget.JVM_17)

val stageRustRuntime by tasks.registering(Sync::class) {
    val abis = runtimeAbis.get().split(',').map(String::trim).filter(String::isNotEmpty)
    require(abis.isNotEmpty() && abis.all(supportedRuntimeAbis::contains)) {
        "runeweaveAbis supports only: ${supportedRuntimeAbis.joinToString(", ")}"
    }

    inputs.property("abis", abis)
    inputs.property("profile", runtimeProfile)
    abis.forEach { abi ->
        from(runtimeDist.dir("$abi/lib")) {
            include("libbevy_runeweave.so")
            into(abi)
        }
        inputs.file(runtimeDist.file("$abi/build-info.txt"))
    }
    into(rustJniLibs)

    doFirst {
        abis.forEach { abi ->
            val library = runtimeDist.file("$abi/lib/libbevy_runeweave.so").asFile
            val buildInfo = runtimeDist.file("$abi/build-info.txt").asFile
            require(library.isFile && buildInfo.isFile) {
                "Missing $runtimeProfile Android runtime for $abi. Run `just build-runtime-android${if (requestedRelease) " --release" else ""}` first."
            }
            val profile = buildInfo.readLines().firstOrNull { it.startsWith("profile=") }?.substringAfter('=')
            require(profile == runtimeProfile) {
                "Android runtime for $abi uses profile '$profile', expected '$runtimeProfile'. Run `just build-runtime-android${if (requestedRelease) " --release" else ""}` first."
            }
        }
    }
}

tasks.named("preBuild").configure { dependsOn(stageRustRuntime) }
