# Graph Report - Harbinger  (2026-11-18)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 226 nodes · 527 edges · 10 communities (7 shown, 3 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 38 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6

## God Nodes (most connected - your core abstractions)
1. `create_server()` - 21 edges
2. `byId()` - 15 edges
3. `as_text()` - 14 edges
4. `StageError` - 12 edges
5. `MemoryStore` - 12 edges
6. `ProviderError` - 12 edges
7. `ProviderTests` - 12 edges
8. `chat()` - 12 edges
9. `build_memory()` - 11 edges
10. `element()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `ProviderTests` --uses--> `ProviderError`  [INFERRED]
  tests/test_providers.py → harbinger/providers.py
- `MemoryBuildTests` --uses--> `MemoryStore`  [INFERRED]
  tests/test_memory_build.py → harbinger/reveriemem/store.py
- `create_server()` --uses--> `StageError`  [INFERRED]
  harbinger/web/server.py → harbinger/reveriemem/execution.py
- `retrieve()` --calls--> `rank()`  [INFERRED]
  harbinger/reveriemem/chat.py → harbinger/reveriemem/retrieval.py
- `create_server()` --calls--> `MemoryStore`  [EXTRACTED]
  harbinger/web/server.py → harbinger/reveriemem/store.py

## Import Cycles
- None detected.

## Communities (10 total, 3 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.11
Nodes (28): chat(), retrieve(), _describe_fact(), _emotion_from(), _fields(), _read_history(), _reason(), workspace() (+20 more)

### Community 1 - "Community 1"
Cohesion: 0.15
Nodes (38): activateTab(), api(), appendList(), appendMessage(), buildMemory(), byId(), canCompose(), chatHistory (+30 more)

### Community 2 - "Community 2"
Cohesion: 0.11
Nodes (22): create_ranker(), rank(), score(), _similarity(), _chunked_body(), create_server(), _build(), _dispatch() (+14 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (9): _compact_json(), MemoryStore, seed_memory(), event(), evidence(), MemoryBuildTests, generate(), relation() (+1 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (21): _catalog_models(), create_providers(), _embedding_vectors(), _finite(), _json_text(), _key(), _model_entry(), _model_provider() (+13 more)

### Community 5 - "Community 5"
Cohesion: 0.21
Nodes (3): ProviderTests, transport(), respond()

### Community 6 - "Community 6"
Cohesion: 0.33
Nodes (3): ChatTests, embed(), generate()

## Knowledge Gaps
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `create_server()` connect `Community 2` to `Community 0`, `Community 3`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.114) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `create_server()` (e.g. with `StageError` and `_dispatch()`) actually correct?**
  _`create_server()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.11149825783972125 - nodes in this community are weakly interconnected._
- **Why does `create_providers()` connect `Community 4` to `Community 2`, `Community 3`, `Community 5`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.14615384615384616 - nodes in this community are weakly interconnected._
- **Why does `MemoryStore` connect `Community 3` to `Community 2`?**
  _High betweenness centrality (0.050) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.10668563300142248 - nodes in this community are weakly interconnected._