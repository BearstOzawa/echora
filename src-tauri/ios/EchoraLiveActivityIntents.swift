import AppIntents
import CoreFoundation
import Foundation

private let liveActivityCommandPrefix = "studio.echora.client.liveactivity."

private final class LiveActivityCommandRouter {
    static let shared = LiveActivityCommandRouter()

    private let lock = NSLock()
    private var handler: ((String) -> Void)?

    func install(_ handler: @escaping (String) -> Void) {
        lock.lock()
        self.handler = handler
        lock.unlock()
    }

    func send(_ command: String) -> Bool {
        lock.lock()
        let currentHandler = handler
        lock.unlock()
        currentHandler?(command)
        return currentHandler != nil
    }
}

func installLiveActivityCommandHandler(_ handler: @escaping (String) -> Void) {
    LiveActivityCommandRouter.shared.install(handler)
}

private func postLiveActivityCommand(_ command: String) {
    if LiveActivityCommandRouter.shared.send(command) { return }
    CFNotificationCenterPostNotification(
        CFNotificationCenterGetDarwinNotifyCenter(),
        CFNotificationName(rawValue: "\(liveActivityCommandPrefix)\(command)" as CFString),
        nil,
        nil,
        true
    )
}

@available(iOS 17.0, *)
struct PreviousTrackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "上一首"
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        postLiveActivityCommand("previous")
        return .result()
    }
}

@available(iOS 17.0, *)
struct TogglePlaybackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "播放或暂停"
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        postLiveActivityCommand("toggle-playback")
        return .result()
    }
}

@available(iOS 17.0, *)
struct NextTrackIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "下一首"
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        postLiveActivityCommand("next")
        return .result()
    }
}

@available(iOS 17.0, *)
struct ToggleLikeIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "喜欢"
    static var openAppWhenRun = false

    func perform() async throws -> some IntentResult {
        postLiveActivityCommand("toggle-like")
        return .result()
    }
}
