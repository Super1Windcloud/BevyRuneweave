#include "game_runtime.h"
#include <zlib.h>

static inline uLong runeweave_crc32(const Bytef *bytes, uInt length) {
    uLong checksum = crc32(0L, Z_NULL, 0);
    return crc32(checksum, bytes, length);
}
