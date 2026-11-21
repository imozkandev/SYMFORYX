#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(bun -e 'import p from "./package.json"; console.log(p.version);')"
ARCH="arm64"
RELEASE_DIR="$ROOT/dist/release"
STAGING_DIR="/tmp/symforyx-dmg-staging"
APP_BUNDLE="$ROOT/apps/macos-native/SYMFORYX.app"
RES_DIR="$APP_BUNDLE/Contents/Resources"

ZIP_NAME="SYMFORYX-v${VERSION}-macos-${ARCH}.zip"
DMG_NAME="SYMFORYX-v${VERSION}-macos-${ARCH}.dmg"

echo "━━━ SYMFORYX v${VERSION} macOS Standalone Release Packager ━━━"
mkdir -p "$RELEASE_DIR"

echo "1/6 Building companion Web UI..."
(cd "$ROOT/apps/web" && ./node_modules/.bin/vite build >/dev/null)

echo "2/6 Building native SwiftUI macOS app + Retina AppIcon.icns..."
bash "$ROOT/apps/macos-native/build-app.sh"

echo "3/6 Compiling self-contained local engine (zero Bun/Node dependency for end users)..."
bun build --compile --minify "$ROOT/apps/server/src/index.ts" --outfile "$RES_DIR/symforyx-engine"
chmod +x "$RES_DIR/symforyx-engine"

echo "4/6 Embedding Web UI & Tool Registry inside SYMFORYX.app/Contents/Resources..."
rm -rf "$RES_DIR/web" "$RES_DIR/registry"
cp -R "$ROOT/apps/web/build" "$RES_DIR/web"
mkdir -p "$RES_DIR/registry"
cp "$ROOT/registry/catalog.json" "$RES_DIR/registry/catalog.json"

# Ad-hoc sign bundle so macOS Apple Silicon allows local execution cleanly
if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP_BUNDLE" 2>/dev/null || true
fi

echo "5/6 Creating ${ZIP_NAME} and ${DMG_NAME}..."
rm -f "$RELEASE_DIR/$ZIP_NAME" "$RELEASE_DIR/$DMG_NAME" "$RELEASE_DIR/SHA256SUMS.txt"

# Clean macOS-preserving ZIP
ditto -c -k --sequesterRsrc --keepParent "$APP_BUNDLE" "$RELEASE_DIR/$ZIP_NAME"

# Drag-and-drop DMG with /Applications shortcut
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R "$APP_BUNDLE" "$STAGING_DIR/SYMFORYX.app"
ln -s /Applications "$STAGING_DIR/Applications"

if hdiutil create -volname "SYMFORYX v${VERSION}" -srcfolder "$STAGING_DIR" -ov -format UDZO "$RELEASE_DIR/$DMG_NAME" >/dev/null 2>&1; then
  echo "    ✓ DMG created: $RELEASE_DIR/$DMG_NAME"
else
  echo "    ⚠ hdiutil could not attach disk image in current environment; ZIP is ready."
fi
rm -rf "$STAGING_DIR"

echo "6/6 Generating SHA256SUMS.txt & GitHub Release notes..."
(
  cd "$RELEASE_DIR"
  FILES=()
  [ -f "$DMG_NAME" ] && FILES+=("$DMG_NAME")
  [ -f "$ZIP_NAME" ] && FILES+=("$ZIP_NAME")
  shasum -a 256 "${FILES[@]}" > SHA256SUMS.txt
)

cat > "$RELEASE_DIR/RELEASE_NOTES.md" << EOF
## SYMFORYX v${VERSION} — Native macOS Desktop Studio (Apple Silicon)

**Zero dependencies required** — Bun, Node, or terminal setup is NOT needed. The local orchestration engine, SQLite vault, and companion Web UI are bundled directly inside \`SYMFORYX.app\`.

### Installation (macOS 14+ · Apple Silicon)
1. Download **\`${DMG_NAME}\`** (or \`${ZIP_NAME}\`) below.
2. Open the DMG and drag **SYMFORYX** into **Applications**.
3. If macOS displays an *"unverified developer"* Gatekeeper warning on first launch, run once in Terminal:
   \`\`\`bash
   xattr -cr /Applications/SYMFORYX.app
   \`\`\`
   *(Or go to **System Settings → Privacy & Security → Open Anyway**.)*

### Highlights
- **100% Native SwiftUI + AppKit Desktop App** (zero WebView / zero Electron)
- **Claude-Code-Style Local Project Engine:** Open any Mac folder or scaffold a project from scratch, edit files (\`⌘S\`), inspect Git diffs, run commands in the built-in Project Terminal (\`⌘J\`), and auto-apply AI edits directly to disk
- **Unrestricted Multi-Model Matrix:** Claude, GPT, Gemini, DeepSeek, Grok, OpenRouter, Ollama, Flux/Fal, Stability, Ideogram, Video/3D/Music & custom model IDs
- **AI Slop Blocker (0–100 Craft Score)** + **Token & Cost Optimizer** + **Live Quotas & Reset Countdowns**
- **14 Ready Studio Schemas** (App Store/Play Store 5-Screen Kit, TR+EN ASO, Video/Promo, Code+Visual+3D+Music)
- **Optional Local Web UI:** Click the Globe icon (\`⌘⇧W\`) inside the app anytime to also open the companion browser UI on the same local database.

### Verification (\`SHA256SUMS.txt\`)
\`\`\`text
$(cat "$RELEASE_DIR/SHA256SUMS.txt")
\`\`\`
EOF

echo ""
echo "✓ Release artifacts ready in: $RELEASE_DIR"
ls -lh "$RELEASE_DIR"
