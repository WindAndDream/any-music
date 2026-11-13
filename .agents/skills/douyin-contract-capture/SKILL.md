---
name: douyin-contract-capture
description: Recapture Douyin website API contracts in the dedicated test browser when live capture is requested. Use for a_bogus, search, session, import or page-fallback observations; this does not validate GM or Tauri Rust transport.
---

# Douyin Contract Capture

Produce a sanitized contract update for the requested Douyin behavior. Read the [website contract](../../../docs/en/cross-platform/platforms/douyin/web-api-contract.md) first.

## Establish the capture boundary

Identify whether the user requests website protocol observation, installed Userscript behavior or desktop native behavior. This skill owns website capture in the dedicated test profile; it is not the product's Rust/system-browser login workflow. GM and native acceptance follow their runtime guides and require separate evidence. A desktop-only fix does not automatically require this skill.

Live capture requires an explicit browser/application inspection request in this task. Without it, inspect existing sanitized contracts and fixtures, report the remaining live checks and leave captureDate unchanged.

Use only an available Chrome DevTools connection to the profile marked `test`. If that capability/profile is unavailable, report it rather than substituting a normal browser, fresh profile or generic web research. Let the user perform login, QR, CAPTCHA and account actions; likes/collections require explicit direction.

On status_code=2483, verification or CAPTCHA, suspend automation and preserve the page until the user handles the challenge.

## Capture the affected contract

Exercise only relevant self/other profiles, search pages, posts/likes, mix directory/content, personal collections, work/music detail or video/note fallbacks.

Retain method/path, semantic query/body keys, consumed fields/codes, auth/privacy/risk behavior, page size, cursor advancement, termination and empty-list semantics. For signing changes record parameter order and presence of cookie, BDMS, Web SecSDK, query-signature and signature-header fields, never their values. For search describe JSON versus length-framed messages, ack/multiple documents; for detail identify API, React Flight or _ROUTER_DATA provenance.

Project a field-shape summary instead of copying personal content or a full response.

## Finish

Update both locale contracts with documentType, platform, runtimeScope and actual captureDate after successful observation. Label website, GM and Rust evidence separately; browser confirmed is not proof of native confirmed. Userscript page/cookie/signer injection follows its [runtime guide](../any-music-userscript-runtime/SKILL.md). Native HTTP/account/login/grants follow the [Tauri guide](../any-music-tauri-runtime/SKILL.md), without importing test-profile credentials.

Run signature vectors, framed-search parsing, cookie projection, bridge isolation and plugin tests plus root gates. If installed Userscript regression was requested, follow its runtime guide for cross-host search/import/playback and artwork. Desktop native regression follows the Tauri guide separately. Record the four playback phases with their runtime, and report privacy/risk blocks and omitted checks without claiming successful capture.
