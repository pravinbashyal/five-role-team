# Conventional Comments format (shared by `reviewer` and `supervisor`)

Every finding:

```
<label> [decorations]: <subject>

[discussion]
```

- Number each comment (`1.`, `2.`, ...) so the worker/orchestrator can reference it precisely.
- Decorate with `(blocking)`, `(non-blocking)`, or `(if-minor)` whenever the default for that label doesn't match your intent — e.g. `issue (non-blocking):` for a real problem that shouldn't hold up this pass, or `suggestion (blocking):` for an improvement you consider mandatory here.
- **Blocking** = `issue` or `suggestion` with no `(non-blocking)`/`(if-minor)` decoration, or anything explicitly marked `(blocking)`. Everything else is **non-blocking**.
