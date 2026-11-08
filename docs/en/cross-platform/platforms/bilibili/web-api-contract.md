---
documentType: platform-interface
runtimeScope: shared
platform: bilibili
captureDate: 2026-09-03
---

# Bilibili Web API Contract

Chinese counterpart: [哔哩哔哩 Web 接口契约](../../../../zh-cn/跨平台/平台接口/哔哩哔哩/网页接口契约.md).

Evidence scope: this page owns website endpoints and fields, not one transport implementation. GM, host-page, BDMS page signing/capture and cross-host playback sections apply to Userscript; Rust CookieStore, native login and HTTP sections apply to desktop. Test-profile website success does not prove GM or clean Rust success. captureDate is the latest actual observation, not acceptance of every section or both runtimes; use each dated environment. See [Userscript](../../../userscript/development.md) and [desktop](../../../desktop/development.md) rules.

> Captured on 2026-09-03. These are internal endpoints used by Bilibili's web frontend, not stable public APIs. Implementations must tolerate missing fields and be retested regularly in a real browser. This document does not store cookies, tokens, device fingerprints, WBI results, or ephemeral CDN URLs.

## 1. Captured Endpoints

| Capability              | Method and path                                  | Key business parameters                                            | Pagination/result                                               | Authentication and signing                     |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------- |
| User state              | `GET /x/web-interface/nav`                       | None                                                               | `isLogin`, `mid`, `uname`, `face`, `wbi_img`                    | Cookie; no WBI                                 |
| Video search            | `GET /x/web-interface/wbi/search/type`           | `search_type=video`, `keyword`, `page`, `page_size`, `order`       | `result[]`, `numResults`                                        | WBI                                            |
| Creator videos/keyword  | `GET /x/space/wbi/arc/search`                    | `mid`, `keyword`, `pn`, `ps`, `order=pubdate`                      | `list.vlist[]`, `page.count`                                    | WBI                                            |
| Creator collection      | `GET /x/polymer/web-space/seasons_archives_list` | `mid`, `season_id`, `page_num`, `page_size`                        | `archives[]`, `meta`, `page.total`                              | Login cookie; current request needs no WBI     |
| Creator audio uploads   | `GET /audio/music-service/web/song/upper`        | `uid`, `pn`, `ps`, `order`                                         | `data[]`, `totalSize`                                           | Current request needs no WBI                   |
| Favorite folders        | `GET /x/v3/fav/folder/created/list-all`          | `up_mid`                                                           | `list[]`                                                        | Private content requires the owner's login     |
| Favorite folder content | `GET /x/v3/fav/resource/list`                    | `media_id`, `pn`, `ps`, `keyword`, `order`                         | `info`, `medias[]`, `has_more`                                  | Private content requires the owner's login     |
| Video details/parts     | `GET /x/web-interface/view`                      | `bvid`                                                             | `owner`, `duration`, `pages[].cid`                              | Current request needs no WBI                   |
| Video audio stream      | `GET /x/player/playurl`                          | `bvid`, `cid`, `fnval=16`, `qn=16`                                 | `dash.audio[]`, `timelength`                                    | Cookie; current request needs no WBI           |
| Cross-host media        | `GET /x/player/playurl`                          | `bvid`, `cid`, `fnval=0`, `platform=html5`, `qn`, `high_quality=1` | `quality`, `accept_quality[]`, `accept_description[]`, `durl[]` | Native-media fallback outside Bilibili         |
| Legacy audio playback   | `GET /audio/music-service-c/web/url`             | `sid`, `privilege=2`, `quality=2`                                  | Expected `cdns[]`                                               | Still needs retesting with a real audio upload |

Web pages also send `web_location`, risk-control image parameters, analytics fields, and dynamic offsets. The adapter starts with the minimum business parameters and adds non-business parameters only when an endpoint actually rejects the request; it does not copy a complete page fingerprint.

## 2. Field Mapping

### Video Search

- Stable ID: `bvid`. Do not use `aid`, which may exceed JavaScript's safe integer range, as the primary key.
- Title: `title`, with search-highlight HTML removed before plain-text display.
- Creator: `mid + author`; cover: `pic`; the raw `duration` clock string can describe the entire multipart upload. Use the selected part's duration for a playable track.
- Publication time: `pubdate` in seconds; tags: comma-separated `tag`.
- Statistics: `play`, `video_review`, `favorites`, `review`, and `like`.

### Creator Uploads

`list.vlist[]` provides `bvid`, `title`, `author`, `mid`, `pic`, `created`, `length`, `play`, `video_review`, and `comment`. Creator keyword search and video uploads use the same endpoint; only the non-empty `keyword` and web page size differ.

### Collections

`meta` provides the collection title, creator `mid`, and total. `archives[]` provides `bvid`, title, cover, duration in seconds, publication time, and view/danmaku statistics. The captured sample had 30 items on one page and 217 total; the adapter must not load all eight pages at once.

### Favorite Folders

`info` provides the title, owner, and total. `medias[]` provides `bvid`, `ugc.first_cid`, creator, cover, duration in seconds, publication time, favorite time, and statistics. Unavailable content may omit playable fields; mapping should skip those entries while retaining a diagnostic count.

### Playback

Search, creator uploads, collection entries and favorite entries represent individual video URLs, defaulting to P1. Their summary durations may aggregate all parts, even when a favorite includes `ugc.first_cid`. Resolve the current listing page's video details with at most three concurrent requests, retaining row order and using P1's CID and duration. Do not fetch subsequent listing pages or media URLs while reading these details. Unavailable videos retain an unknown duration instead of the aggregate total; other failures remain retryable page errors. A collection URL (`space.bilibili.com/<mid>/lists/<seasonId>`) remains a lazy listing, while a video URL with `?p=` selects one part.

Saved tracks without a CID also select the part from their video URL before resolving media, without using `view.duration` as a fallback. Playback-confirmed positive finite durations update the ordinary track's local library metadata, so an existing favorite is repaired after playback without changing its favorite time, custom name, playlist membership or current playback context. Custom-track durations remain recipe-owned. These are offline-tested adapter/workbench rules; they do not add live website, GM or Rust acceptance evidence.

First call `view?bvid=` to obtain the selected `pages[].cid`, then request DASH from `playurl`. Video URL imports select `pages[].page` using the positive integer `p` query parameter, defaulting to P1. Use that part's `duration` and, for multipart uploads, `part` title; `view.duration` is the combined duration and must not define a single-part export range. Preserve the existing P1 track ID; later parts append their stable CID and retain `?p=` in the source page URL so queues, caches and downloads distinguish them. Reject an unavailable part rather than silently selecting P1. Select only `dash.audio[]`, choose the highest available `bandwidth`, and retain `backupUrl`. The addresses expire and must be resolved again for every playback attempt; they cannot be stored in history, tags, or custom tracks.

The 2026-09-03 capture confirmed that one DASH response can contain several audio representations. The consumed fields are `id`, `bandwidth`, `mimeType/mime_type`, `codecs`, `baseUrl/base_url`, and `backupUrl/backup_url`. Default playback chooses the highest `bandwidth`; a session-only quality ID combines the representation ID and codec, and every switch re-resolves and validates that ID without using an ephemeral URL as identity.

DASH audio works on a Bilibili host but its CDN returns 403 to a native media element on other hosts even with no-referrer/crossorigin attributes. Outside Bilibili, request the HTML5 `durl[]` compatibility stream instead. It is a combined MP4 and therefore uses more bandwidth, but it remains Range-playable; do not replace it with a full GM download and large Blob.

The 2026-09-03 capture also confirmed that an HTML5 request for the highest `qn` can return an actual `quality` below the highest value advertised by `accept_quality[]`. The adapter exposes only tiers no higher than the granted `quality` and pairs them with `accept_description[]`. If a switch returns a different actual `quality`, the requested tier is treated as unavailable instead of silently playing another tier.

Export is different from native playback because Mediabunny actively reads media bytes through GM HTTP. DASH, HTML5, and legacy audio CDN reads include the fixed temporary `Referer: https://www.bilibili.com/` header and `credentials: 'include'`; otherwise primary and fallback nodes may all return 403. This header belongs only to the current `ResolvedMediaSource` and is never persisted or copied from the current host page.

The native controls' built-in download action bypasses those headers, fallbacks, and transcoding and may save a CDN error page. The player uses `controlslist=nodownload` and routes download intent through the managed export pipeline.

## 3. WBI

`nav.data.wbi_img` returns `img_url` and `sub_url`. Remove both file extensions, concatenate their filenames, and apply Bilibili's fixed permutation table to produce a 32-character mixin key. Add a seconds-level `wts` to the business parameters, sort by key, encode while filtering `!'()*`, and finally calculate MD5 as `w_rid`.

The adapter caches only the derived key for a short window and does not cache the `nav` login result. A `-352` or `-412` response enters a risk-control or rate-limit error without trying to bypass it. A `-101` response transitions the session to expired.

## 4. URL Recognition

The current importer accepts:

- `space.bilibili.com/<mid>/lists/<seasonId>`;
- `space.bilibili.com/<mid>/upload/video`;
- `space.bilibili.com/<mid>/upload/audio`;
- `space.bilibili.com/<mid>/search?keyword=...`;
- `space.bilibili.com/<mid>/favlist?fid=<mediaId>`;
- `www.bilibili.com/video/<bvid>`, optionally with `?p=<positive integer>` to import one selected part.

Accept only exact Bilibili hostnames and numeric IDs or BV IDs. Reject lookalike domains and unknown paths.

## 5. Cross-Site Covers

When `pic` or `cover` images from `i*.hdslb.com` are shown on a non-Bilibili host such as Douyin, sending the page Referer causes the CDN to reject them with 403. `Track` still stores the stable cover URL, while the UI consistently renders it through `RemoteImage` with `referrerpolicy="no-referrer"`. Do not construct proxy URLs in the mapper or persist cover bytes.

The same cover was verified on a Douyin host page: loading with the default Referer failed, while `no-referrer` succeeded. If the CDN policy changes, retest this condition before adding a GM image fallback at the runtime layer.

## 6. Retesting

Use the repository skill `$bilibili-contract-capture` when the contract changes. At minimum, retest signed-out `nav`, the second search page, the second page of a large collection, an empty creator audio list, a private favorite folder, a multipart video, DASH audio fallback nodes, fixed export request headers and Range reads, HTML5 compatibility media on a non-Bilibili host, authentication expiring mid-session, and cross-host cover loading.
