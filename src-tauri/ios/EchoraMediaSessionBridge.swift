import AVFAudio
import CoreFoundation
import Foundation
import MediaPlayer

public typealias EchoraMediaSessionHandler = @convention(c) (UnsafePointer<CChar>) -> Void

private let liveActivityCommandPrefix = "studio.echora.client.liveactivity."

private func receiveLiveActivityCommand(
    _ center: CFNotificationCenter?,
    _ observer: UnsafeMutableRawPointer?,
    _ name: CFNotificationName?,
    _ object: UnsafeRawPointer?,
    _ userInfo: CFDictionary?
) {
    guard let observer, let rawName = name?.rawValue as String? else { return }
    let bridge = Unmanaged<EchoraMediaSessionBridge>.fromOpaque(observer).takeUnretainedValue()
    bridge.handleLiveActivityCommand(String(rawName.dropFirst(liveActivityCommandPrefix.count)))
}

private final class EchoraMediaSessionBridge {
    static let shared = EchoraMediaSessionBridge()

    private var handler: EchoraMediaSessionHandler?
    private var commandTargets: [Any] = []
    private var notificationTokens: [NSObjectProtocol] = []
    private var installed = false

    func install(_ handler: @escaping EchoraMediaSessionHandler) {
        self.handler = handler
        installLiveActivityCommandHandler { [weak self] command in
            self?.handleLiveActivityCommand(command)
        }
        guard !installed else { return }
        installed = true

        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true
        center.skipForwardCommand.isEnabled = true
        center.skipBackwardCommand.isEnabled = true
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.preferredIntervals = [10]

        commandTargets = [
            center.playCommand.addTarget { [weak self] _ in
                self?.emit(["type": "play"])
                return .success
            },
            center.pauseCommand.addTarget { [weak self] _ in
                self?.emit(["type": "pause"])
                return .success
            },
            center.nextTrackCommand.addTarget { [weak self] _ in
                self?.emit(["type": "next"])
                return .success
            },
            center.previousTrackCommand.addTarget { [weak self] _ in
                self?.emit(["type": "previous"])
                return .success
            },
            center.changePlaybackPositionCommand.addTarget { [weak self] event in
                guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
                    return .commandFailed
                }
                self?.emit(["type": "seek-to", "position": positionEvent.positionTime])
                return .success
            },
            center.skipForwardCommand.addTarget { [weak self] event in
                let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 10
                self?.emit(["type": "seek-forward", "offset": interval])
                return .success
            },
            center.skipBackwardCommand.addTarget { [weak self] event in
                let interval = (event as? MPSkipIntervalCommandEvent)?.interval ?? 10
                self?.emit(["type": "seek-backward", "offset": interval])
                return .success
            },
        ]

        let darwinCenter = CFNotificationCenterGetDarwinNotifyCenter()
        let observer = Unmanaged.passUnretained(self).toOpaque()
        for command in ["previous", "toggle-playback", "next", "toggle-like"] {
            CFNotificationCenterAddObserver(
                darwinCenter,
                observer,
                receiveLiveActivityCommand,
                "\(liveActivityCommandPrefix)\(command)" as CFString,
                nil,
                .deliverImmediately
            )
        }

        let notifications = NotificationCenter.default
        notificationTokens = [
            notifications.addObserver(
                forName: AVAudioSession.interruptionNotification,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                self?.handleInterruption(notification)
            },
            notifications.addObserver(
                forName: AVAudioSession.routeChangeNotification,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                self?.handleRouteChange(notification)
            },
        ]
    }

    private func handleInterruption(_ notification: Notification) {
        guard let rawType = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: rawType) else { return }
        switch type {
        case .began:
            emit(["type": "interruption-began"])
        case .ended:
            let rawOptions = notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
            let shouldResume = AVAudioSession.InterruptionOptions(rawValue: rawOptions).contains(.shouldResume)
            emit(["type": "interruption-ended", "shouldResume": shouldResume])
        @unknown default:
            break
        }
    }

    private func handleRouteChange(_ notification: Notification) {
        guard let rawReason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: rawReason),
              reason == .oldDeviceUnavailable else { return }
        emit(["type": "route-disconnected"])
    }

    fileprivate func handleLiveActivityCommand(_ command: String) {
        guard ["previous", "toggle-playback", "next", "toggle-like"].contains(command) else { return }
        emit(["type": command])
    }

    private func emit(_ payload: [String: Any]) {
        guard let handler,
              JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let value = String(data: data, encoding: .utf8) else { return }
        value.withCString { handler($0) }
    }
}

@_cdecl("echora_media_session_install")
public func echoraMediaSessionInstall(_ handler: @escaping EchoraMediaSessionHandler) {
    EchoraMediaSessionBridge.shared.install(handler)
}
