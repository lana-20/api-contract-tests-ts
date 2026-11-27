// A GraphQL validation rule that rejects queries nested deeper than `maxDepth`.
// Contact -> messages -> contact -> messages ... is a cycle, so without a limit a
// single small request can ask for an enormous response.
// (Libraries such as graphql-depth-limit do the same; this version is short enough to read.)
import { GraphQLError, Kind, type ASTVisitor, type SelectionSetNode, type ValidationContext } from 'graphql';

export function depthLimit(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = Object.fromEntries(
      context.getDocument().definitions.flatMap((d) => (d.kind === Kind.FRAGMENT_DEFINITION ? [[d.name.value, d]] : [])),
    );

    /** Depth of the deepest field under this selection set. */
    function depth(selectionSet: SelectionSetNode | undefined, seen: Set<string>): number {
      if (!selectionSet) return 0;
      return Math.max(
        0,
        ...selectionSet.selections.map((selection) => {
          if (selection.kind === Kind.FIELD) {
            // Introspection fields (__typename, __schema) do not count.
            if (selection.name.value.startsWith('__')) return 0;
            return selection.selectionSet ? 1 + depth(selection.selectionSet, seen) : 1;
          }
          if (selection.kind === Kind.INLINE_FRAGMENT) return depth(selection.selectionSet, seen);
          // Named fragment: follow it once (guards against fragment cycles).
          const name = selection.name.value;
          if (seen.has(name) || !fragments[name]) return 0;
          return depth(fragments[name].selectionSet, new Set(seen).add(name));
        }),
      );
    }

    return {
      OperationDefinition(node) {
        const actual = depth(node.selectionSet, new Set());
        if (actual > maxDepth) {
          context.reportError(
            new GraphQLError(`Query depth ${actual} exceeds the maximum of ${maxDepth}.`, { nodes: [node] }),
          );
        }
      },
    };
  };
}
