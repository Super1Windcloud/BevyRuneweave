#!/bin/sh

for argument in "$@"; do
    case "$argument" in
        *list.def*) cp "$argument" /tmp/runeweave-windows-list.def ;;
    esac
done

exec /Users/super/Library/Caches/cargo-zigbuild/0.23.0/wrappers/c7b1/zigcc-x86_64-pc-windows-gnu-d9a9.sh "$@"
