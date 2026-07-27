# Plan the effects — decide once, apply the plan, converge on rerun

Use this procedure for a workflow with several effects — files written, state changed, processes started, remote resources touched — or one that needs a preview, can stop partway, or serves several frontends. A small atomic write needs none of it; make the write.

## 1. State the contract, effects included

Before code, name what a caller can observe: the success surface, the failure behavior, and every effect the workflow may have — files, state, processes, remote calls. An effect the contract doesn't name is an effect no test will think to check.

## 2. Validate at the boundary

Parse external input once, at the edge. Validate its complete structure, normalize it, and apply defaults there, so interior code receives a settled model it can trust. Reject invalid input before any effect runs. A rejection names the offending value and where it came from, the rule it violates, and one next action — the reader is having a bad moment; hand them the fix.

Preflight the predictable failures too — missing targets, permissions, version mismatches — before the first write, while stopping is still free.

## 3. Compute the plan before the first mutation

Gather observed state at the boundary, pass ordinary data into a pure decision, and return a plan: the complete list of operations the workflow intends.

```text
inputs + observed state -> decide -> plan
plan -> apply -> observed outcomes -> result
```

A thin executor applies the operations in the plan and nothing else. Previews and dry runs render the plan; machine-readable output serializes it; the completion report renders the plan plus the outcomes observed while applying it. Nothing recomputes after execution what the workflow meant to do — the plan is the record of intent.

## 4. Apply narrowly

Route every mutation through one small boundary. Write only when the intended state differs from the current state. Prefer atomic replacement, or staging the platform can recover, over editing in place. When ownership or safety is uncertain — a file the user may have edited, a resource another process may hold — perform fewer effects and run more checks; refusing with a reason beats guessing.

## 5. Define the reruns

Reruns are part of the contract. Define each: after success, a rerun is a no-op and reports itself as one; after partial failure, a rerun converges toward the same intended state, with no duplicate entries, no repeated external effects, and no loss of user-owned data. Record enough observed outcome to resume, or to converge from any state the workflow can leave behind.

## 6. Prove it at the public boundary

Exercise the real entry point — the actual command, API, or generated artifact, with real schemas and fixtures where the contract depends on them. Cover the failure surface: malformed input, refused preconditions, partial progress, uncertain ownership. Prove the rerun claims: a second run after success is a no-op, and a representative partial state converges. Skip runtime tests for relationships the compiler already makes exhaustive.

When the workflow established or consumed a shared authority along the way, record it in `{{map_dir}}80-development/canonical-sets.md` (the header lives in [bind-the-fact.md](bind-the-fact.md)), and report the contract, the effect boundary, and the rerun behavior in your summary.

## Done when

- the contract names every effect, and validation rejects bad input before any effect runs;
- the complete plan exists before the first mutation, and the executor applies only the plan;
- previews, machine output, and reports render from the plan and observed outcomes;
- mutations pass through one boundary that writes only on difference, atomically or recoverably;
- a green second run is a proven no-op, and representative partial states converge;
- proof exercised the real entry point across success and failure.
