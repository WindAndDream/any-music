# Plugin VM

- Shared, permissionless QuickJS kernel used by the browser adapter and testkit. No DOM, Worker creation, Node, Tauri, business data, network or storage ports.
- Guest source is text evaluated only by the locked, patched engine. Never evaluate guest code in the host. `engine/` is generated from the pinned upstream source using `scripts/build-engine.py`; preserve its patch, compiler settings, licenses and hashes.
- `/profile` stays engine-free. Unknown profiles, engine/hash mismatches and increased budgets fail closed. Clock, scheduling, random and pure standard tools are explicit trusted ports.
- Only bounded JSON crosses the realm; serialize inside the interrupted VM, release every handle and deferred promise on all paths. Tests belong in `test/` and must exercise hostile code in the real engine.
