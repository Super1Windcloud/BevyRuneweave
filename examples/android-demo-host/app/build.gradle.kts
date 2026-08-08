import org.gradle.api.tasks.Exec
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val runtimeLanguage = providers.gradleProperty("runeweaveLanguage").orElse("typescript")
val runtimeAbis = providers.gradleProperty("runeweaveAbis").orElse("arm64-v8a,x86_64")
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
        buildConfigField("String", "RUNEWEAVE_LANGUAGE", "\"${runtimeLanguage.get()}\"")
    }

    sourceSets["main"].jniLibs.srcDir(rustJniLibs)
    buildFeatures.buildConfig = true

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

val buildRustHost by tasks.registering(Exec::class) {
    val output = rustJniLibs.get().asFile
    val manifest = rootProject.layout.projectDirectory.file("runtime/Cargo.toml").asFile
    val abis = runtimeAbis.get().split(',').map(String::trim).filter(String::isNotEmpty)

    inputs.files(
        rootProject.fileTree("runtime/src"),
        rootProject.file("../../Cargo.toml"),
        rootProject.file("../../Cargo.lock"),
        rootProject.fileTree("../../src"),
        rootProject.fileTree("../../crates"),
        rootProject.fileTree("../../bevy_mod_scripting") { exclude("**/target/**") },
        manifest,
    )
    inputs.property("language", runtimeLanguage)
    inputs.property("abis", abis)
    outputs.dir(output)

    doFirst { output.deleteRecursively() }
    commandLine(
        listOf("cargo", "ndk") +
            abis.flatMap { listOf("-t", it) } +
            listOf(
                "-P", "26",
                "-o", output.absolutePath,
                "build", "--release",
                "--manifest-path", manifest.absolutePath,
                "--no-default-features", "--features", runtimeLanguage.get(),
            )
    )
}

tasks.named("preBuild").configure { dependsOn(buildRustHost) }
