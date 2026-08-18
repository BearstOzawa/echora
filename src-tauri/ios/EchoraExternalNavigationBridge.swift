import Foundation
import UIKit

@_cdecl("echora_external_url_open")
public func echoraExternalUrlOpen(_ pointer: UnsafePointer<CChar>) -> Bool {
    guard let url = URL(string: String(cString: pointer)),
          ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
          UIApplication.shared.canOpenURL(url) else { return false }
    UIApplication.shared.open(url, options: [:], completionHandler: nil)
    return true
}
