#!/bin/sh
set -eu

if [ "$#" -ne 4 ]; then
    echo "Usage: package-dmg.sh <runtime-dir> <assets-dir> <output.dmg> <version>" >&2
    exit 2
fi

runtime_dir=$1
assets_dir=$2
output_file=$3
version=$4
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "$script_dir/../../../.." && pwd)
staging=$(mktemp -d "${TMPDIR:-/tmp}/bevy-runeweave-dmg.XXXXXX")
trap 'rm -rf "$staging"' EXIT HUP INT TERM

app="$staging/Bevy RuneWeave.app"
contents="$app/Contents"
macos="$contents/MacOS"
frameworks="$contents/Frameworks"
resources="$contents/Resources"
mkdir -p "$macos" "$frameworks" "$resources"

cp "$runtime_dir/bevy-runeweave-runtime" "$macos/bevy-runeweave-runtime"
chmod 755 "$macos/bevy-runeweave-runtime"
cp "$runtime_dir/lib/libbevy_runeweave.dylib" "$frameworks/libbevy_runeweave.dylib"
cp -R "$assets_dir" "$resources/assets"
cp "$script_dir/Info.plist" "$contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$contents/Info.plist"

iconset="$staging/AppIcon.iconset"
mkdir -p "$iconset"
for size in 16 32 128 256 512; do
    double=$((size * 2))
    sips -z "$size" "$size" "$repo_root/assets/branding/bevy_icon.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
    sips -z "$double" "$double" "$repo_root/assets/branding/bevy_icon.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$resources/AppIcon.icns"

codesign --force --deep --sign "${MACOS_SIGN_IDENTITY:--}" "$app"
ln -s /Applications "$staging/Applications"
mkdir -p "$(dirname -- "$output_file")"
rm -f "$output_file"
hdiutil create -volname "Bevy RuneWeave" -srcfolder "$staging" -ov -format UDZO "$output_file"
echo "Created $output_file"
