# BMS-First Scripting Architecture

Bevy Runeweave uses `bevy_mod_scripting` as the sole foundation for script-facing APIs. Scripts
operate on the real Bevy `World` through reflected types, registered functions, guarded references,
queries, resources, and script systems.

## Authoritative State

The Bevy `World` is authoritative. A script component is a real registered Bevy component, and a
script resource is a real registered Bevy resource. Rust systems and scripts observe the same state.
Runtime APIs must not maintain a second ECS snapshot that later materializes into Bevy components.

## API Registration

Script APIs are defined once through BMS:

1. Register script-visible types with Bevy reflection and the applicable component/resource data.
2. Register constructors, methods, and commands in `AppScriptFunctionRegistry` using BMS namespaces
   and binding helpers.
3. Let language adapters convert `ScriptValue` and `ReflectReference` to native Lua and QuickJS
   values.
4. Generate or update TypeScript declarations from the registered contract.

Language adapters may expose the BMS core globals needed to reach the registry. Product features
must not be implemented as unrelated handwritten globals in each language runtime.

## Access And Lifetime

All reflected world access goes through `WorldGuard` and its access claims. References must follow
`ReflectReference` validity and allocation rules. Script systems declare component/resource access
and schedule placement through the BMS script-system infrastructure.

## Legacy Migration

`src/ecs_api` currently maintains `EcsValue` snapshots and mirrors them into `ScriptComponents` and
`ScriptResources`. It remains temporarily so existing game packages keep running, but it is frozen:

- do not add new capabilities to it;
- migrate one domain at a time to reflected Bevy types and BMS-registered functions;
- keep Lua and QuickJS migrations behaviorally equivalent;
- remove migrated snapshot state, language globals, SDK wrappers, and compatibility tests together.

Input, networking, rendering, physics, audio, and future script APIs follow the same BMS registration
path even when their implementation uses platform-specific code internally.
