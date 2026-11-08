# Validation boundary

The public `/schema` entry accepts registered schema names only. Transport adapters must call
`decodeProtocolJson` on bounded UTF-8 JSON text, never `JSON.parse` first. The in-process
`assertSchema` helper accepts trusted plain DTOs and rejects accessors without evaluating them.
It cannot inspect a malicious Proxy safely; VM adapters must serialize within the guest budget.
