import type { DirectorySuggestionsResponse } from "@getpaseo/protocol/messages";

export interface WorkspaceFileSearchEntry {
  path: string;
  name: string;
  directory: string;
}

type DirectorySuggestionEntry = NonNullable<
  DirectorySuggestionsResponse["payload"]["entries"]
>[number];

export function describeWorkspaceFilePath(path: string): WorkspaceFileSearchEntry {
  const normalized = path.replace(/\\/g, "/");
  const separator = normalized.lastIndexOf("/");
  return {
    path: normalized,
    name: separator >= 0 ? normalized.slice(separator + 1) : normalized,
    directory: separator >= 0 ? normalized.slice(0, separator) : "",
  };
}

export function describeFileEntries(
  entries: readonly DirectorySuggestionEntry[],
): WorkspaceFileSearchEntry[] {
  return entries
    .filter((entry) => entry.kind === "file")
    .map((entry) => describeWorkspaceFilePath(entry.path));
}
