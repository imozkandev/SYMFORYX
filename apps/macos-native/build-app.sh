#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/SYMFORYX.app"
BIN="$APP/Contents/MacOS/SYMFORYX"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>tr</string>
  <key>CFBundleExecutable</key>
  <string>SYMFORYX</string>
  <key>CFBundleIdentifier</key>
  <string>dev.ozkandev.symforyx</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>SYMFORYX</string>
  <key>CFBundleDisplayName</key>
  <string>SYMFORYX</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
EOF

mkdir -p /tmp/symforyx-swift-cache
echo "Generating native macOS AppIcon.icns..."
swiftc -module-cache-path /tmp/symforyx-swift-cache -framework AppKit -framework CoreGraphics "$DIR/gen-icon.swift" -o /tmp/symforyx-gen-icon
/tmp/symforyx-gen-icon "$APP/Contents/Resources/AppIcon.icns"

echo "Compiling native macOS SwiftUI app (zero WebView)..."
swiftc \
  -O \
  -parse-as-library \
  -module-cache-path /tmp/symforyx-swift-cache \
  -target arm64-apple-macosx14.0 \
  -framework SwiftUI \
  -framework AppKit \
  -framework UniformTypeIdentifiers \
  "$DIR/Sources/Models.swift" \
  "$DIR/Sources/SymforyxStore.swift" \
  "$DIR/Sources/Views.swift" \
  "$DIR/Sources/AppMain.swift" \
  -o "$BIN"

chmod +x "$BIN"
echo "✓ Built native app: $APP"
