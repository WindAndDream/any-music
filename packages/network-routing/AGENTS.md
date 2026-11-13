# Portable request routing

- Own bounded attempts, cancellation, deadlines and passive proxy health; no DOM, Node, GM, music models, credentials, network calls or persistence.
- Runtime injects a monotonic clock/timer and actual transport. Never classify an unknown network error or timeout as a proven proxy failure.
- Replay and parallel attempts require an explicit replay-safe operation. Losing attempts and expired leases must not publish results.
- Use only public exports; tests mirror src under test. Run package tests/typecheck and repository gates.
