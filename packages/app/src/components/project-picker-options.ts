import { buildWorkingDirectorySuggestions } from "@/utils/working-directory-suggestions";

export interface BuildProjectPickerOptionsInput {
  recommendedPaths: string[];
  serverPaths: string[];
  query: string;
  searchQuery?: string;
}

/**
 * Home-scoped Add Project search never needs a blank query.
 * Blank input only shows local recommendations; the daemon short-circuits blank
 * absolute searches, but skipping the RPC avoids a pointless round-trip.
 */
export function shouldFetchAddProjectDirectories(query: string): boolean {
  return query.trim().length > 0;
}

/**
 * A leading slash on a single segment is ambiguous in the Add Project search UI:
 * mobile users commonly enter `/docker` while looking for a directory named
 * `docker`. Search that name across the daemon home, while retaining `/docker`
 * as a separate literal-path option.
 */
export function getProjectPickerDirectorySearchQuery(query: string): string {
  const trimmedQuery = query.trim();
  const match = /^\/([^/]+)\/?$/.exec(trimmedQuery);
  return match?.[1] ?? trimmedQuery;
}

export interface ProjectPickerPathOption {
  kind: "path";
  path: string;
}

export interface ProjectPickerSuggestionOption {
  kind: "suggestion";
  path: string;
}

export type ProjectPickerOption = ProjectPickerPathOption | ProjectPickerSuggestionOption;

// Matches the daemon's filesystem semantics, not the client's: POSIX absolute,
// tilde, Windows drive letter (C:\ or C:/), or UNC (\\server\share).
export function isOpenableProjectPath(query: string): boolean {
  const trimmedQuery = query.trim();
  return (
    trimmedQuery.startsWith("/") ||
    trimmedQuery.startsWith("~") ||
    trimmedQuery.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/.test(trimmedQuery)
  );
}

export function buildProjectPickerOptions(
  input: BuildProjectPickerOptionsInput,
): ProjectPickerOption[] {
  const suggestedPaths = buildWorkingDirectorySuggestions({
    recommendedPaths: input.recommendedPaths,
    serverPaths: input.serverPaths,
    query: input.searchQuery ?? input.query,
  });
  const suggestions = suggestedPaths.map<ProjectPickerSuggestionOption>((path) => ({
    kind: "suggestion",
    path,
  }));
  const trimmedQuery = input.query.trim();

  if (!isOpenableProjectPath(trimmedQuery) || suggestedPaths.includes(trimmedQuery)) {
    return suggestions;
  }

  const literalPath = { kind: "path", path: trimmedQuery } as const;
  return input.searchQuery && input.searchQuery !== trimmedQuery
    ? [...suggestions, literalPath]
    : [literalPath, ...suggestions];
}
