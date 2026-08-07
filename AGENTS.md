# Development defaults

- Treat TypeScript as the default language for all subsequent game development.
- Implement gameplay, entities, systems, input, UI behavior, and iteration primarily in TypeScript scripts and their compiled JavaScript assets.
- Change the Rust runtime or host only when a required capability cannot reasonably be implemented through the TypeScript scripting API.
- Keep the Windows demo host focused on downloading assets and launching the TypeScript runtime; do not move game-specific behavior into the host.
