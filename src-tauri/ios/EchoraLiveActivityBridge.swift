import ActivityKit
import Foundation

@available(iOS 16.2, *)
private actor EchoraLiveActivityStore {
    static let shared = EchoraLiveActivityStore()

    private var activity: Activity<EchoraNowPlayingAttributes>?

    func update(
        title: String,
        artist: String,
        artworkBase64: String?,
        isPlaying: Bool,
        isLiked: Bool,
        elapsed: Double,
        duration: Double
    ) async {
        let state = EchoraNowPlayingAttributes.ContentState(
            title: title,
            artist: artist,
            artworkBase64: artworkBase64,
            isPlaying: isPlaying,
            isLiked: isLiked,
            elapsed: max(0, elapsed),
            duration: max(0, duration)
        )
        let content = ActivityContent(state: state, staleDate: nil)

        let existingActivities = Activity<EchoraNowPlayingAttributes>.activities
        if let current = activity ?? existingActivities.first {
            activity = current
            await current.update(content)
            for stale in existingActivities where stale.id != current.id {
                await stale.end(nil, dismissalPolicy: .immediate)
            }
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        activity = try? Activity.request(
            attributes: EchoraNowPlayingAttributes(),
            content: content,
            pushType: nil
        )
    }

    func end() async {
        let activeActivities = Activity<EchoraNowPlayingAttributes>.activities
        for activeActivity in activeActivities {
            await activeActivity.end(nil, dismissalPolicy: .immediate)
        }
        self.activity = nil
    }
}

@_cdecl("echora_live_activity_update")
public func echoraLiveActivityUpdate(
    _ titlePointer: UnsafePointer<CChar>,
    _ artistPointer: UnsafePointer<CChar>,
    _ artworkPointer: UnsafePointer<CChar>?,
    _ isPlaying: Int32,
    _ isLiked: Int32,
    _ elapsed: Double,
    _ duration: Double
) {
    guard #available(iOS 16.2, *) else { return }
    let title = String(cString: titlePointer)
    let artist = String(cString: artistPointer)
    let artwork = artworkPointer.map(String.init(cString:))
    Task {
        await EchoraLiveActivityStore.shared.update(
            title: title,
            artist: artist,
            artworkBase64: artwork,
            isPlaying: isPlaying != 0,
            isLiked: isLiked != 0,
            elapsed: elapsed,
            duration: duration
        )
    }
}

@_cdecl("echora_live_activity_end")
public func echoraLiveActivityEnd() {
    guard #available(iOS 16.2, *) else { return }
    Task { await EchoraLiveActivityStore.shared.end() }
}
