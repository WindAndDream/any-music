---
name: bilibili-contract-capture
description: Recapture Bilibili website API contracts in the dedicated test browser when live capture is requested. Use for WBI, search, import, login or playback field observations; this does not validate GM or Tauri Rust transport.
---

# Bilibili Contract Capture

Produce a sanitized contract update for the requested Bilibili behavior. Read the [website contract](../../../docs/en/cross-platform/platforms/bilibili/web-api-contract.md) first.

## Establish the capture boundary

Identify whether the user requests website protocol observation, installed Userscript behavior or desktop native behavior. This skill owns website capture in the dedicated test profile; it is not the product's Rust/system-browser login workflow. GM and native acceptance follow their runtime guides and require separate evidence. A desktop-only fix does not automatically require this skill.

Live capture requires an explicit browser/application inspection request in this task. Without it, inspect existing sanitized contracts and fixtures, report the remaining live checks and leave captureDate unchanged.

Use only an available Chrome DevTools connection to the profile marked `test`. If that capability/profile is unavailable, report the limitation; do not substitute a normal browser, a fresh profile or generic web research for authenticated observations. Let the user perform login, QR, CAPTCHA and account actions. On risk control, stop automated capture and retain the page for the user; do not evade it.

Do not retain cookies, SESSDATA, CSRF values, generated WBI signatures, signed CDN URLs, QR keys, fingerprints or full request headers. Project only field shapes when inspection would expose personal data.

## Capture the affected contract

Exercise only the smallest relevant actions: nav/session, search pages, season/list, UP video/audio/keyword submissions, favorites, video view or audio play URL.

Retain method and stable endpoint path, semantic query keys with generated keys identified separately, response codes/consumed fields, auth requirements, page-size/termination behavior and error states. Summaries should explain missing or changed fields without copying a personal response.

## Finish

Update both locale contracts with documentType, platform, runtimeScope and the actual captureDate after successful observation. Label evidence as website observation, GM or Rust and identify unverified layers. Runtime changes follow [Userscript](../any-music-userscript-runtime/SKILL.md) or [Tauri](../any-music-tauri-runtime/SKILL.md).

Run deterministic request/mapping/signature tests and root gates. If installed Userscript regression was requested, follow its runtime guide for cross-host search/import/playback, DASH/HTML5 media, export headers, Range and artwork. Desktop native regression follows the Tauri guide separately. Record the four playback phases with their runtime, and report blocked/omitted checks without claiming a recapture.
