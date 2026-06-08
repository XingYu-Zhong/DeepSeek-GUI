#!/usr/bin/env swift
// vision-ocr.swift — Apple Vision Framework OCR CLI
// Usage: vision-ocr.swift <image-path> [language]
// Outputs JSON: {"text": "...", "confidence": 0.95, "observations": [...]}

import Foundation
import Vision
#if canImport(AppKit)
import AppKit
#endif

func ocrImage(at path: String, languages: [String]) throws -> [String: Any] {
    let url = URL(fileURLWithPath: path)
    guard FileManager.default.fileExists(atPath: path) else {
        throw NSError(domain: "vision-ocr", code: 1, userInfo: [NSLocalizedDescriptionKey: "File not found: \(path)"])
    }

    #if canImport(AppKit)
    guard let image = NSImage(contentsOf: url) else {
        throw NSError(domain: "vision-ocr", code: 2, userInfo: [NSLocalizedDescriptionKey: "Cannot load image: \(path)"])
    }
    guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw NSError(domain: "vision-ocr", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot create CGImage"])
    }
    #else
    throw NSError(domain: "vision-ocr", code: 4, userInfo: [NSLocalizedDescriptionKey: "AppKit not available"])
    #endif

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = languages.isEmpty ? ["en-US"] : languages
    request.usesLanguageCorrection = true
    // Set revision for best accuracy
    if #available(macOS 13.0, *) {
        request.revision = VNRecognizeTextRequestRevision3
    }

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    try handler.perform([request])

    guard let results = request.results else {
        return ["text": "", "confidence": 0.0, "observations": []]
    }

    var fullText = ""
    var totalConfidence: Float = 0.0
    var observations: [[String: Any]] = []
    var lineCount = 0

    for observation in results {
        guard let topCandidate = observation.topCandidates(1).first else { continue }

        let text = topCandidate.string
        let confidence = topCandidate.confidence

        let bbox = observation.boundingBox
        let bboxDict: [String: Double] = [
            "x": Double(bbox.origin.x),
            "y": Double(bbox.origin.y),
            "width": Double(bbox.size.width),
            "height": Double(bbox.size.height)
        ]

        observations.append([
            "text": text,
            "confidence": Double(confidence),
            "bbox": bboxDict
        ])

        fullText += (fullText.isEmpty ? "" : "\n") + text
        totalConfidence += confidence
        lineCount += 1
    }

    let avgConfidence = lineCount > 0 ? Double(totalConfidence) / Double(lineCount) : 0.0

    return [
        "text": fullText,
        "confidence": avgConfidence,
        "observations": observations
    ]
}

// Main
let args = CommandLine.arguments
guard args.count >= 2 else {
    let err: [String: Any] = ["error": "Usage: vision-ocr.swift <image-path> [lang1,lang2,...]"]
    let data = try! JSONSerialization.data(withJSONObject: err, options: .prettyPrinted)
    FileHandle.standardError.write(data)
    exit(1)
}

let imagePath = args[1]
let languages: [String] = args.count >= 3 ? args[2].split(separator: ",").map(String.init) : []

do {
    let result = try ocrImage(at: imagePath, languages: languages)
    let data = try JSONSerialization.data(withJSONObject: result, options: .prettyPrinted)
    FileHandle.standardOutput.write(data)
} catch {
    let err: [String: Any] = ["error": error.localizedDescription]
    let data = try! JSONSerialization.data(withJSONObject: err, options: .prettyPrinted)
    FileHandle.standardError.write(data)
    exit(1)
}
