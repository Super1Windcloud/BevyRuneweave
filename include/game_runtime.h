#ifndef BEVY_SCRIPT_GAME_RUNTIME_H
#define BEVY_SCRIPT_GAME_RUNTIME_H

#ifdef __cplusplus
extern "C" {
#endif

/* Blocks until the Bevy event loop exits. Returns 0 on success. */
int game_runtime_run(const char *script_path);

/* Reloads the configured script on the next frame. */
void game_runtime_request_reload(void);

#ifdef __cplusplus
}
#endif

#endif

