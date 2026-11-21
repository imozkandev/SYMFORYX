import AppKit
import CoreGraphics
import Foundation

// Renders the crisp minimal SYMFORYX geometric brand icon directly into a Retina Apple .icns file.
let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "/tmp/AppIcon.icns"

func renderPNG(px: Int) -> Data? {
    let size = CGFloat(px)
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(
        data: nil,
        width: px,
        height: px,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else { return nil }

    // Flip Y to match SVG coordinates (0,0 top-left)
    ctx.translateBy(x: 0, y: size)
    ctx.scaleBy(x: 1, y: -1)
    ctx.setShouldAntialias(true)
    ctx.setAllowsAntialiasing(true)

    let s = size / 64.0

    // macOS squircle background (#111113) with subtle hairline border (#27272A)
    let pad = 4.0 * s
    let rect = CGRect(x: pad, y: pad, width: size - pad * 2, height: size - pad * 2)
    let bgPath = CGPath(roundedRect: rect, cornerWidth: 13.5 * s, cornerHeight: 13.5 * s, transform: nil)
    ctx.setFillColor(red: 0.067, green: 0.067, blue: 0.075, alpha: 1.0)
    ctx.addPath(bgPath)
    ctx.fillPath()

    ctx.setStrokeColor(red: 0.17, green: 0.175, blue: 0.195, alpha: 1.0)
    ctx.setLineWidth(1.2 * s)
    ctx.addPath(bgPath)
    ctx.strokePath()

    // Left & right harmonic orchestration cadence rails
    ctx.setStrokeColor(red: 0.96, green: 0.96, blue: 0.95, alpha: 0.34)
    ctx.setLineWidth(2.1 * s)
    ctx.setLineCap(.round)
    ctx.move(to: CGPoint(x: 14 * s, y: 27 * s))
    ctx.addLine(to: CGPoint(x: 14 * s, y: 37 * s))
    ctx.move(to: CGPoint(x: 50 * s, y: 27 * s))
    ctx.addLine(to: CGPoint(x: 50 * s, y: 37 * s))
    ctx.strokePath()

    // Upper & lower converging harmonic S-ribbons
    ctx.setStrokeColor(red: 0.96, green: 0.96, blue: 0.95, alpha: 1.0)
    ctx.setLineWidth(4.2 * s)
    ctx.setLineCap(.round)

    ctx.move(to: CGPoint(x: 43.5 * s, y: 21.5 * s))
    ctx.addCurve(to: CGPoint(x: 32 * s, y: 15 * s), control1: CGPoint(x: 42.6 * s, y: 17 * s), control2: CGPoint(x: 38 * s, y: 15 * s))
    ctx.addCurve(to: CGPoint(x: 20.5 * s, y: 22.5 * s), control1: CGPoint(x: 24.8 * s, y: 15 * s), control2: CGPoint(x: 20.5 * s, y: 18 * s))
    ctx.addCurve(to: CGPoint(x: 27.8 * s, y: 30 * s), control1: CGPoint(x: 20.5 * s, y: 26.4 * s), control2: CGPoint(x: 23.8 * s, y: 28.5 * s))
    ctx.strokePath()

    ctx.move(to: CGPoint(x: 20.5 * s, y: 42.5 * s))
    ctx.addCurve(to: CGPoint(x: 32 * s, y: 49 * s), control1: CGPoint(x: 21.4 * s, y: 47 * s), control2: CGPoint(x: 26 * s, y: 49 * s))
    ctx.addCurve(to: CGPoint(x: 43.5 * s, y: 41.5 * s), control1: CGPoint(x: 39.2 * s, y: 49 * s), control2: CGPoint(x: 43.5 * s, y: 46 * s))
    ctx.addCurve(to: CGPoint(x: 36.2 * s, y: 34 * s), control1: CGPoint(x: 43.5 * s, y: 37.6 * s), control2: CGPoint(x: 40.2 * s, y: 35.5 * s))
    ctx.strokePath()

    // Central cobalt conductor nexus node (#3B82F6)
    ctx.setFillColor(red: 0.231, green: 0.51, blue: 0.965, alpha: 1.0)
    let r = 3.7 * s
    ctx.fillEllipse(in: CGRect(x: 32 * s - r, y: 32 * s - r, width: r * 2, height: r * 2))

    guard let cgImg = ctx.makeImage() else { return nil }
    let rep = NSBitmapImageRep(cgImage: cgImg)
    return rep.representation(using: .png, properties: [:])
}

func appendUInt32BE(_ data: inout Data, _ val: UInt32) {
    var be = val.bigEndian
    data.append(Data(bytes: &be, count: 4))
}

let icnsEntries: [(String, Int)] = [
    ("icp4", 16),
    ("icp5", 32),
    ("icp6", 64),
    ("ic07", 128),
    ("ic08", 256),
    ("ic09", 512),
    ("ic10", 1024),
    ("ic11", 32),
    ("ic12", 64),
    ("ic13", 256),
    ("ic14", 512),
]

var chunks = Data()
for (fourCC, px) in icnsEntries {
    guard let png = renderPNG(px: px), let tag = fourCC.data(using: .ascii) else { continue }
    chunks.append(tag)
    appendUInt32BE(&chunks, UInt32(8 + png.count))
    chunks.append(png)
}

var icns = Data("icns".utf8)
appendUInt32BE(&icns, UInt32(8 + chunks.count))
icns.append(chunks)

let outURL = URL(fileURLWithPath: outPath)
try? FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
try icns.write(to: outURL)
