import {
  compareMatchScores,
  fuzzyPolicyForToken,
  scoreMatch,
} from "@getpaseo/protocol/search/text-match";
import { joinDirectoryPath, parentDirectory, pathBaseName } from "@/add-project-flow/options";
import { buildWorkingDirectorySuggestions } from "@/utils/working-directory-suggestions";

export interface BuildProjectPickerOptionsInput {
  recommendedPaths: string[];
  serverPaths: string[];
  query: string;
}

/**
 * Home-scoped Add Project search never needs a blank query.
 * Blank input only shows local recommendations; the daemon short-circuits blank
 * absolute searches, but skipping the RPC avoids a pointless round-trip.
 */
export function shouldFetchAddProjectDirectories(query: string): boolean {
  return query.trim().length > 0;
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

export interface BuildDirectoryBrowseOptionsInput {
  path: string;
  pathExists: boolean;
  childPaths: string[];
}

export interface DirectoryBrowseTarget {
  requestedPath: string;
  parentPath: string;
  nameQuery: string;
}

export interface DirectoryBrowseResolution {
  exactPath: string | null;
  matchingPaths: string[];
}

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
    query: input.query,
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
  return [literalPath, ...suggestions];
}

export function getDirectoryBrowseTarget(query: string): DirectoryBrowseTarget | null {
  const requestedPath = query.trim();
  if (!isOpenableProjectPath(requestedPath)) return null;

  if (requestedPath === "~") {
    return { requestedPath, parentPath: requestedPath, nameQuery: "" };
  }
  if (/[\\/]$/.test(requestedPath)) {
    const directoryPath = trimTrailingPathSeparators(requestedPath);
    return { requestedPath: directoryPath, parentPath: directoryPath, nameQuery: "" };
  }

  let parentPath = parentDirectory(requestedPath);
  if (!parentPath) return null;
  if (/^[A-Za-z]:$/.test(parentPath)) {
    parentPath += requestedPath.includes("\\") ? "\\" : "/";
  }
  return {
    requestedPath,
    parentPath,
    nameQuery: pathBaseName(requestedPath),
  };
}

export function resolveDirectoryBrowseEntries(input: {
  target: DirectoryBrowseTarget;
  directoryNames: string[];
  limit: number;
}): DirectoryBrowseResolution {
  const { target } = input;
  if (!target.nameQuery) {
    return {
      exactPath: target.requestedPath,
      matchingPaths: input.directoryNames
        .slice(0, input.limit)
        .map((name) => joinDirectoryPath(target.requestedPath, name)),
    };
  }

  const exactName = input.directoryNames.find((name) => name === target.nameQuery);
  const fuzzy = fuzzyPolicyForToken(target.nameQuery);
  const ranked = input.directoryNames
    .flatMap((name) => {
      const score = scoreMatch(target.nameQuery, name, { fuzzy });
      return score ? [{ name, score }] : [];
    })
    .sort(
      (left, right) =>
        compareMatchScores(left.score, right.score) || left.name.localeCompare(right.name),
    )
    .slice(0, input.limit)
    .map(({ name }) => joinDirectoryPath(target.parentPath, name));

  return {
    exactPath: exactName ? joinDirectoryPath(target.parentPath, exactName) : null,
    matchingPaths: ranked,
  };
}

/**
 * Path completion shows an exact directory first when it exists, followed by
 * either its children or fuzzy matches from the entered path's parent.
 */
export function buildDirectoryBrowseOptions(
  input: BuildDirectoryBrowseOptionsInput,
): ProjectPickerOption[] {
  const path = input.path.trim();
  if (!path) return [];

  const seen = new Set<string>(input.pathExists ? [path] : []);
  const children = input.childPaths.flatMap((childPath) => {
    const trimmed = childPath.trim();
    if (!trimmed || seen.has(trimmed)) return [];
    seen.add(trimmed);
    return [{ kind: "suggestion" as const, path: trimmed }];
  });

  if (input.pathExists) return [{ kind: "path", path }, ...children];
  // Keep a typed path actionable when the parent listing has no match. When
  // fuzzy matches exist, those suggestions replace the nonexistent literal.
  return children.length > 0 ? children : [{ kind: "path", path }];
}

function trimTrailingPathSeparators(path: string): string {
  if (path === "/" || /^[A-Za-z]:[\\/]$/.test(path)) return path;
  return path.replace(/[\\/]+$/, "");
}
