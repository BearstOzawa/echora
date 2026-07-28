import AVFAudio
import Foundation
import Speech

public typealias EchoraSpeechRecognitionHandler = @convention(c) (UnsafePointer<CChar>) -> Void

private final class EchoraSpeechRecognitionBridge {
    static let shared = EchoraSpeechRecognitionBridge()

    private let audioEngine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
    private var handler: EchoraSpeechRecognitionHandler?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var generation: Int64 = 0
    private var tapInstalled = false

    func install(_ handler: @escaping EchoraSpeechRecognitionHandler) {
        self.handler = handler
    }

    func start(generation: Int64) {
        cancel(emitEnded: false)
        self.generation = generation
        emit(["type": "status", "status": "requesting"], generation: generation)

        requestSpeechPermission(generation: generation) { [weak self] granted in
            guard let self, self.generation == generation else { return }
            guard granted else {
                self.emitError("not-allowed", generation: generation)
                return
            }
            self.requestMicrophonePermission(generation: generation)
        }
    }

    func stop() {
        guard generation != 0, request != nil else { return }
        let currentGeneration = generation
        emit(["type": "status", "status": "stopping"], generation: currentGeneration)
        if audioEngine.isRunning { audioEngine.stop() }
        removeInputTap()
        request?.endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self, self.generation == currentGeneration else { return }
            self.finish(generation: currentGeneration)
        }
    }

    func cancel(emitEnded: Bool = false) {
        let previousGeneration = generation
        generation = 0
        if audioEngine.isRunning { audioEngine.stop() }
        removeInputTap()
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        restorePlaybackSession()
        if emitEnded, previousGeneration != 0 {
            emit(["type": "ended"], generation: previousGeneration)
        }
    }

    private func requestSpeechPermission(generation: Int64, completion: @escaping (Bool) -> Void) {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized:
            completion(true)
        case .notDetermined:
            SFSpeechRecognizer.requestAuthorization { status in
                DispatchQueue.main.async { completion(status == .authorized) }
            }
        case .denied, .restricted:
            completion(false)
        @unknown default:
            completion(false)
        }
    }

    private func requestMicrophonePermission(generation: Int64) {
        let session = AVAudioSession.sharedInstance()
        switch session.recordPermission {
        case .granted:
            beginRecognition(generation: generation)
        case .undetermined:
            session.requestRecordPermission { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self, self.generation == generation else { return }
                    if granted { self.beginRecognition(generation: generation) }
                    else { self.emitError("not-allowed", generation: generation) }
                }
            }
        case .denied:
            emitError("not-allowed", generation: generation)
        @unknown default:
            emitError("not-allowed", generation: generation)
        }
    }

    private func beginRecognition(generation: Int64) {
        guard self.generation == generation else { return }
        guard let recognizer, recognizer.isAvailable else {
            emitError("network", generation: generation)
            return
        }

        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
        } catch {
            emitError("audio-capture", generation: generation)
            return
        }

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.channelCount > 0, format.sampleRate > 0 else {
            emitError("audio-capture", generation: generation)
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            request.append(buffer)
        }
        tapInstalled = true

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self, self.generation == generation else { return }
                if let result {
                    self.emit([
                        "type": "transcript",
                        "text": result.bestTranscription.formattedString,
                        "final": result.isFinal,
                    ], generation: generation)
                    if result.isFinal {
                        self.finish(generation: generation)
                        return
                    }
                }
                if let error {
                    let code = (error as NSError).code == 203 ? "no-speech" : "network"
                    self.emitError(code, generation: generation)
                }
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            emit(["type": "status", "status": "listening"], generation: generation)
        } catch {
            emitError("audio-capture", generation: generation)
        }
    }

    private func finish(generation: Int64) {
        guard self.generation == generation else { return }
        self.generation = 0
        if audioEngine.isRunning { audioEngine.stop() }
        removeInputTap()
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        restorePlaybackSession()
        emit(["type": "ended"], generation: generation)
    }

    private func emitError(_ code: String, generation: Int64) {
        guard self.generation == generation else { return }
        self.generation = 0
        if audioEngine.isRunning { audioEngine.stop() }
        removeInputTap()
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        restorePlaybackSession()
        emit(["type": "error", "code": code], generation: generation)
    }

    private func removeInputTap() {
        guard tapInstalled else { return }
        audioEngine.inputNode.removeTap(onBus: 0)
        tapInstalled = false
    }

    private func restorePlaybackSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
    }

    private func emit(_ payload: [String: Any], generation: Int64) {
        guard let handler else { return }
        var event = payload
        event["generation"] = generation
        guard JSONSerialization.isValidJSONObject(event),
              let data = try? JSONSerialization.data(withJSONObject: event),
              let value = String(data: data, encoding: .utf8) else { return }
        value.withCString { handler($0) }
    }
}

@_cdecl("echora_speech_recognition_install")
public func echoraSpeechRecognitionInstall(_ handler: @escaping EchoraSpeechRecognitionHandler) {
    EchoraSpeechRecognitionBridge.shared.install(handler)
}

@_cdecl("echora_speech_recognition_start")
public func echoraSpeechRecognitionStart(_ generation: Int64) {
    EchoraSpeechRecognitionBridge.shared.start(generation: generation)
}

@_cdecl("echora_speech_recognition_stop")
public func echoraSpeechRecognitionStop() {
    EchoraSpeechRecognitionBridge.shared.stop()
}

@_cdecl("echora_speech_recognition_cancel")
public func echoraSpeechRecognitionCancel() {
    EchoraSpeechRecognitionBridge.shared.cancel()
}
