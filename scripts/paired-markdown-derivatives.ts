/**
 * Separate byte-identical paired-derivative Markdown code blocks (`.zh.md`,
 * `.vi.md`) from the primary checks performed on their unsuffixed English
 * siblings. The pairing gate owns cross-language identity for the pairs it
 * manages; source-oriented gates consume one copy.
 */

/** The result of separating canonical blocks from paired derivatives. */
export interface MarkdownDerivativePartition<T> {
  /** Blocks that still require the caller's owning check. */
  primary: T[]
  /** Derivative blocks covered by the byte-identical unsuffixed sequence. */
  derivatives: T[]
}

/** Suffixes that mark a paired derivative of its unsuffixed English source. */
const DERIVATIVE_SUFFIXES = ['.zh.md', '.vi.md']

/** Return the unsuffixed sibling of a paired-derivative Markdown path. */
function unsuffixedSibling(doc: string): string | null {
  for (const suffix of DERIVATIVE_SUFFIXES) {
    if (doc.endsWith(suffix)) return `${doc.slice(0, -suffix.length)}.md`
  }
  return null
}

/**
 * Partition complete byte-identical paired-derivative block sequences from
 * primary blocks. A partial or reordered match stays primary so the caller
 * fails closed; the translation-pairing gate reports the cross-language
 * mismatch.
 *
 * @param blocks - Blocks in repository scan order.
 * @param docOf - Repository-relative Markdown path owning a block.
 * @param fingerprintOf - Block kind/info string plus byte-exact body.
 * @returns Primary blocks and paired derivatives, preserving order.
 */
export function partitionPairedMarkdownDerivatives<T>(
  blocks: readonly T[],
  docOf: (block: T) => string,
  fingerprintOf: (block: T) => string,
): MarkdownDerivativePartition<T> {
  const byDoc = new Map<string, T[]>()
  for (const block of blocks) {
    const doc = docOf(block)
    const group = byDoc.get(doc)
    if (group) group.push(block)
    else byDoc.set(doc, [block])
  }

  const derivativeDocs = new Set<string>()
  for (const [doc, candidates] of byDoc) {
    const sibling = unsuffixedSibling(doc)
    if (sibling === null) continue
    const originals = byDoc.get(sibling)
    if (originals === undefined || originals.length !== candidates.length) continue
    if (candidates.every((candidate, index) => {
      const original = originals[index]
      return original !== undefined && fingerprintOf(candidate) === fingerprintOf(original)
    })) {
      derivativeDocs.add(doc)
    }
  }

  const primary: T[] = []
  const derivatives: T[] = []
  for (const block of blocks) {
    (derivativeDocs.has(docOf(block)) ? derivatives : primary).push(block)
  }
  return { primary, derivatives }
}
