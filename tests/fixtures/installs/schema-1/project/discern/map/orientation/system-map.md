# System map

Bird's-eye view of how Demo fits together. Read this once and the rest of the map should slot into place.

> This doc is a skeleton. The `discern setup` command fills it from the repo and a few questions it asks you. The map is **ASCII-first** so it lives in the text and stays diffable — draw the boxes and arrows below.

---

## The system, end to end

<!-- setup fills this -->

Replace the sketch below with an ASCII diagram of the real components and the flow between them. Show the major pieces as boxes and the direction data or control moves as arrows. Keep it to one screen; depth belongs in the subsystem leaves.

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   <input>   │ ───► │  <core>     │ ───► │  <output>   │
└─────────────┘      └─────────────┘      └─────────────┘
```

---

## Where each piece runs

<!-- setup fills this -->

_(A short list: which parts are processes, which are libraries, which are external services; what holds the persistent state; where work happens synchronously vs in the background. The "physical" view that the box diagram above does not show.)_

---

## How the map relates to the subtrees

<!-- setup fills this -->

_(A table mapping each region of the diagram to the subsystem subtree that explains it in depth — the numbered subtrees on the map front page. This is what turns the picture into a navigation aid.)_

| Region of the map | Documented in      |
| ----------------- | ------------------ |
| _component_       | `../NN-subsystem/` |
