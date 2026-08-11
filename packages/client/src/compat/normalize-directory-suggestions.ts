import type { DirectorySuggestionsResponse } from "@getpaseo/protocol/messages";

type WireDirectorySuggestionsPayload = DirectorySuggestionsResponse["payload"];
type DirectorySuggestionEntry = NonNullable<WireDirectorySuggestionsPayload["entries"]>[number];

/**
 * Consumer-facing payload after the client return boundary.
 * `entries` is always present so callers never re-implement legacy projection.
 */
export type DirectorySuggestionsPayload = Omit<WireDirectorySuggestionsPayload, "entries"> & {
  entries: DirectorySuggestionEntry[];
};

// COMPAT(directorySuggestionsEntries): added in client v0.3.2, remove after
// 2027-02-12 once daemon floor >= v0.1.14. Earlier daemons omit typed `entries`,
// so project legacy `directories` at the client return boundary.
export function normalizeDirectorySuggestionsPayload(
  payload: WireDirectorySuggestionsPayload,
): DirectorySuggestionsPayload {
  return {
    ...payload,
    entries:
      payload.entries ?? payload.directories.map((path) => ({ path, kind: "directory" as const })),
  };
}
