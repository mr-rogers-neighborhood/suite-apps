/**
 * The shared in-memory host services, plus nothing Canvas-specific.
 *
 * The double lives in `@suite/pack-runtime` so all three pack suites prove the
 * same contract. This file stays so the pack's own tests import a local name.
 */
export {
  type MemoryDocuments,
  type MemoryFiles,
  type MemoryRecents,
  memoryDocuments,
  memoryFiles,
  memoryRecents,
  textOf,
} from "@suite/pack-runtime";
