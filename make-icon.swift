import AppKit

let destination = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)

func color(_ rgb: UInt32) -> NSColor {
    NSColor(
        srgbRed: CGFloat((rgb >> 16) & 255) / 255,
        green: CGFloat((rgb >> 8) & 255) / 255,
        blue: CGFloat(rgb & 255) / 255,
        alpha: 1
    )
}

func makeIcon(pixels: Int) throws -> Data {
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)

    let scale = CGFloat(pixels) / 1024
    let context = NSGraphicsContext.current!.cgContext
    context.translateBy(x: 0, y: CGFloat(pixels))
    context.scaleBy(x: scale, y: -scale)

    // Match the top-down geometry in app-icon.svg.
    let tile = NSBezierPath(roundedRect: NSRect(x: 96, y: 96, width: 832, height: 832), xRadius: 188, yRadius: 188)
    let gradient = NSGradient(starting: color(0x32336B), ending: color(0x161630))!
    NSGraphicsContext.saveGraphicsState()
    tile.addClip()
    gradient.draw(from: NSPoint(x: 148, y: 96), to: NSPoint(x: 876, y: 928), options: [.drawsBeforeStartingLocation, .drawsAfterEndingLocation])
    NSGraphicsContext.restoreGraphicsState()

    let letter = NSBezierPath()
    letter.windingRule = .evenOdd
    letter.move(to: NSPoint(x: 340, y: 244))
    letter.line(to: NSPoint(x: 596, y: 244))
    letter.line(to: NSPoint(x: 721, y: 369))
    letter.line(to: NSPoint(x: 721, y: 463))
    letter.curve(to: NSPoint(x: 609, y: 575), controlPoint1: NSPoint(x: 721, y: 538), controlPoint2: NSPoint(x: 684, y: 575))
    letter.line(to: NSPoint(x: 455, y: 575))
    letter.line(to: NSPoint(x: 455, y: 739))
    letter.curve(to: NSPoint(x: 435, y: 759), controlPoint1: NSPoint(x: 455, y: 752), controlPoint2: NSPoint(x: 448, y: 759))
    letter.line(to: NSPoint(x: 340, y: 759))
    letter.curve(to: NSPoint(x: 320, y: 739), controlPoint1: NSPoint(x: 327, y: 759), controlPoint2: NSPoint(x: 320, y: 752))
    letter.line(to: NSPoint(x: 320, y: 264))
    letter.curve(to: NSPoint(x: 340, y: 244), controlPoint1: NSPoint(x: 320, y: 251), controlPoint2: NSPoint(x: 327, y: 244))
    letter.close()

    // Cut the transfer arrow into the letter instead of adding a separate glyph.
    letter.move(to: NSPoint(x: 422, y: 384))
    for point in [
        NSPoint(x: 530, y: 384), NSPoint(x: 530, y: 347), NSPoint(x: 622, y: 421),
        NSPoint(x: 530, y: 495), NSPoint(x: 530, y: 458), NSPoint(x: 422, y: 458),
    ] {
        letter.line(to: point)
    }
    letter.close()
    color(0xFFF1D8).setFill()
    letter.fill()

    let fold = NSBezierPath()
    fold.move(to: NSPoint(x: 596, y: 244))
    fold.line(to: NSPoint(x: 721, y: 369))
    fold.line(to: NSPoint(x: 631, y: 369))
    fold.curve(to: NSPoint(x: 596, y: 334), controlPoint1: NSPoint(x: 608, y: 369), controlPoint2: NSPoint(x: 596, y: 357))
    fold.close()
    color(0x78EACB).setFill()
    fold.fill()

    return bitmap.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let suffix = scale == 2 ? "@2x" : ""
        let file = destination.appendingPathComponent("icon_\(size)x\(size)\(suffix).png")
        try makeIcon(pixels: size * scale).write(to: file)
    }
}
