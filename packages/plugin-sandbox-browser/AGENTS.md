# Browser Sandbox Adapter

- Shared trusted transport; only `/browser` creates a Worker from the fixed application resource. Root owns bounded sessions, admission, deadlines and termination; VM semantics belong to `plugin-vm`.
- Guest code travels as JSON text to the VM, never as a script, import URL, blob/data Worker or host function. Build the trusted worker and bundled engine offline.
- This package confers no native authority. Tauri binds the real isolated WebView to its native subject and enforces the exact OS/WebView/Profile/resource admission and native resource filter before guest delivery. Unknown targets remain closed. Userscript must not import this package; offline adapter tests do not establish target acceptance.
- Test malicious messages, disposal/startup races, duplicate replies, timeouts and shared VM behavior without starting any app/browser.
