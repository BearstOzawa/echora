import ObjectiveC.runtime
import UIKit

public typealias EchoraQuickActionHandler = @convention(c) (UnsafePointer<CChar>) -> Void
private var echoraQuickActionHandler: EchoraQuickActionHandler?
private var echoraQuickActionsInstalled = false

@_cdecl("echora_quick_actions_install")
public func echoraQuickActionsInstall(_ handler: @escaping EchoraQuickActionHandler) {
    echoraQuickActionHandler = handler
    guard !echoraQuickActionsInstalled,
          let delegate = UIApplication.shared.delegate,
          let delegateClass = object_getClass(delegate) else { return }

    let selector = #selector(UIApplicationDelegate.application(_:performActionFor:completionHandler:))
    let implementation: @convention(block) (AnyObject, UIApplication, UIApplicationShortcutItem, @escaping (Bool) -> Void) -> Void = { _, _, shortcutItem, completion in
        shortcutItem.type.withCString { pointer in
            echoraQuickActionHandler?(pointer)
        }
        completion(true)
    }
    let method = imp_implementationWithBlock(implementation as Any)
    if class_addMethod(delegateClass, selector, method, "v@:@@@?") {
        echoraQuickActionsInstalled = true
    }
}
