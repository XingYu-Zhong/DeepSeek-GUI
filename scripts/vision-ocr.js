#!/usr/bin/env osascript -l JavaScript
// vision-ocr.js — Apple Vision Framework OCR via JXA
// Usage: osascript -l JavaScript vision-ocr.js <image-path> [lang1,lang2]
// Output: JSON on stdout

ObjC.import('Foundation')
ObjC.import('AppKit')
ObjC.import('Vision')

function run(argv) {
    if (argv.length < 1) {
        return JSON.stringify({ error: "Usage: vision-ocr.js <image-path> [langs]" })
    }

    const imagePath = argv[0]
    const languages = argv.length >= 2 ? argv[1].split(',') : []

    const url = $.NSURL.fileURLWithPath(imagePath)
    const image = $.NSImage.alloc.initWithContentsOfURL(url)

    if (!image) {
        return JSON.stringify({ error: "Cannot load image: " + imagePath })
    }

    const cgImage = image.CGImageForProposedRectContextHints($.nil, $.nil, $.nil)

    const request = $.VNRecognizeTextRequest.alloc.init
    request.recognitionLevel = $.VNRequestTextRecognitionLevelAccurate
    request.usesLanguageCorrection = true

    if (languages.length > 0) {
        request.recognitionLanguages = $.NSArray.arrayWithArray(languages)
    }

    const handler = $.VNImageRequestHandler.alloc.initWithCGImageOptions(cgImage, $.NSDictionary.alloc.init)
    handler.performRequestsError($([request]), $())

    const results = request.results
    const count = results.count
    let text = ''
    let totalConfidence = 0.0

    for (let i = 0; i < count; i++) {
        const obs = results.objectAtIndex(i)
        const candidate = obs.topCandidates(1).objectAtIndex(0)
        text += (text === '' ? '' : '\n') + candidate.string.js
        totalConfidence += candidate.confidence
    }

    return JSON.stringify({
        text: text,
        confidence: count > 0 ? totalConfidence / count : 0,
        lineCount: count
    })
}
