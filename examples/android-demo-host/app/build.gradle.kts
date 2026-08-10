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

val adbExecutable = androidComponents.sdkComponents.adb
val demoApplicationId = "io.github.super1windcloud.runeweave.demo"
tasks.register<Exec>("launchDebug") {
    group = "install"
    description = "Installs the Debug APK and launches the demo on the connected Android device."
    dependsOn("installDebug")
    doFirst {
        commandLine(
            adbExecutable.get().asFile.absolutePath,
            "shell",
            "am",
            "start",
            "-W",
            "-S",
            "-n",
            "$demoApplicationId/.MainActivity",
        )
    }
}

tasks.register<Exec>("logcatDebug") {
    group = "install"
    description = "Installs and launches the Debug APK, then streams logcat for its process."
    dependsOn("launchDebug")
    isIgnoreExitValue = true

    doFirst {
        val adb = adbExecutable.get().asFile.absolutePath
        var pid = ""
        for (attempt in 1..50) {
            val process = ProcessBuilder(adb, "shell", "pidof", "-s", demoApplicationId)
                .redirectErrorStream(true)
                .start()
            val output = process.inputStream.bufferedReader().use { it.readText() }.trim()
            if (process.waitFor() == 0 && output.all(Char::isDigit)) {
                pid = output
                break
            }
            Thread.sleep(100)
        }
        require(pid.isNotEmpty()) {
            "The Debug app did not start within 5 seconds; inspect unfiltered logcat for startup failures."
        }

        logger.lifecycle("Streaming logcat for $demoApplicationId (pid $pid). Press Ctrl-C to stop.")
        commandLine(adb, "logcat", "--pid=$pid", "-v", "threadtime")
    }
}
