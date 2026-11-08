---
documentType: platform-interface
platform: netease
runtimeScope: shared
verificationDate: 2026-10-27
---

# NetEase Cloud Music integration

Chinese counterpart: [网易云音乐接口接入](../../../../zh-cn/跨平台/平台接口/网易云/接口接入.md).

`packages/plugin-source-netease` owns the built-in provider `netease` and module `source.netease`. Its lightweight root exports metadata and local URL validation; `/runtime` owns official protocols, DTO validation, mapping, lazy listings and media resolution. Both applications inject their existing HTTP ports. The Node SDK in the sibling `WangYiMusicApi` repository is reference code, not a production dependency or a required local server.

## Requests and parameters

All endpoints below are relative to `https://music.163.com/api/`. Built-in calls explicitly include credentials, have a 15-second deadline and a 4 MiB response budget. POST bodies use `application/x-www-form-urlencoded`; structured values are JSON strings.

| Operation        | Method / endpoint                 | Parameters / result                                                                                                                                         |
| ---------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Song search      | POST `cloudsearch/pc`             | `s`, `type=1`, `limit` (1–100), zero-based `offset`, `total=true`; `result.songCount` / `result.songs`                                                      |
| Song details     | GET `v3/song/detail`              | `c=[{"id":33894312}]`; at most 100 IDs per consumed page, reordered to input IDs                                                                            |
| Playlist IDs     | GET `v6/playlist/detail`          | `id`, `n=0`, `s=0`; `playlist.trackIds` is the complete manifest, not `playlist.tracks`                                                                     |
| Album            | GET `v1/album/{id}`               | `album` and `songs`; locally sliced after one bounded request                                                                                               |
| Artist hot songs | GET `v1/artist/{id}`              | `artist` and `hotSongs`; this is the upstream hot-song subset                                                                                               |
| Session          | GET `w/nuser/account/get`         | `profile.userId` / `nickname`; explicit null account/profile means signed out                                                                               |
| Media descriptor | POST `song/enhance/player/url/v1` | `ids=[id]`, `level=jymaster` by default, `encodeType=flac`; actual `level`, `br`, `encodeType`, `time`, `url`, `code`, `freeTrialInfo` determine the result |

Imports accept official HTTPS `music.163.com` song/playlist/album/artist URLs with a unique positive safe integer `id`, including `/#/` and `/m/` routes. Other origins, duplicate IDs and conflicting routes are rejected before HTTP. Stable track IDs are `netease:audio:{songId}`; only stable page references and metadata enter the library. Named artists whose upstream numeric ID is zero retain their names without a stable artist ID; song IDs remain strictly positive.

Playlist iterators load one ID manifest, then one bounded details batch per consumer step. Early close performs no later requests. Continuation resumes at the selected page; unavailable song IDs may be absent without ending later pages. Each operation forwards cancellation and rejects late results. Retries create fresh requests.

Media resolution performs one descriptor request and no byte probes or downloads. It reports only the actual representation returned by the account, without advertising unverified qualities. Explicit quality changes reject upstream downgrades. Missing URLs, denied songs and trial-only clips fail explicitly; no outer-URL fallback fabricates success. Media stays ephemeral and enters the existing native-streaming / Range / complete-read fallback chain.

## Runtime boundaries and evidence

- Userscript uses `GM_xmlhttpRequest` with included credentials; `@connect` includes `music.163.com` and the `music.126.net` CDN family. Login uses the official site and manager-owned target cookies.
- Desktop uses account-bound IPC/Rust HTTP, native CookieStores/proxies and native QR generation/polling. QR status alone does not commit a login: Rust requires `MUSIC_U` and a matching positive account/profile identity. Credentials never reach the renderer. Existing media grants bind the descriptor to its account and release idempotently. A user reported code 8821 after scan confirmation; additional security verification may be required, is not yet supported, and login remains unverified.
- Native mobile does not assemble NetEase or admit NetEase accounts. Its capability/acceptance matrix is unchanged.
- On 2026-10-26, anonymous direct HTTP checks returned valid song search, song details, a 200-ID playlist with `n=0`, album songs, artist hot songs and signed-out session envelopes. Song `33894312` returned a `standard` MP3 for `standard` and an actual `exhigh` MP3 when requesting `exhigh`/`hires`/`jymaster`; unavailable IDs returned null URLs and `code=-110`. The portable adapter itself also returned correctly mapped first pages for search/playlist/album/artist imports, and the resolved free-song CDN answered a 64-byte Range request with HTTP 206. These are anonymous direct protocol observations, not a website/browser recapture and not GM/Rust acceptance.
- [GM-R3 installed acceptance](../../../../baselines/theme-ui-migration/T13-gm-r3.json) on 2026-10-27 records real GM signed-out session, public import/native playback on unrelated and source hosts, cancellation/network error/explicit retry, and the zero-artist-ID repair. Final installed `c944e1c9…907134` returns 30 tracks for `童声` on both hosts; an explicit static-host next page retains 60 tracks/two pages. This GM evidence does not establish Rust transport acceptance.
- Deterministic tests cover lazy requests/order, cancellation/retry, session failures, trial rejection, actual quality, runtime composition and native identity parsing. NetEase account login/paid qualities, real desktop QR login and native account/proxy/media playback still need their own live acceptance. No `captureDate` is asserted.
