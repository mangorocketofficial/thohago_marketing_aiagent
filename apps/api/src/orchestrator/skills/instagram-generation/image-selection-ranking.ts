type CandidateSafety = Record<string, string>;

export type ImageSelectionCandidate = {
  fileId: string;
  fileName: string;
  relativePath: string;
  fileSize: number | null;
  detectedAt: string | null;
  modifiedAtMs: number;
  searchText: string;
  sceneTags: string[];
  safety: CandidateSafety;
  fileContentHash: string | null;
};

const SAFE_BLOCK_LEVELS = new Set(["likely", "very_likely", "high"]);
const SAFE_PENALTY_LEVELS = new Set(["possible", "medium", "moderate"]);

const normalizeTokenSource = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toTokenSet = (value: string): Set<string> => {
  const normalized = normalizeTokenSource(value);
  if (!normalized) {
    return new Set<string>();
  }
  return new Set(normalized.split(" ").filter((entry) => entry.length >= 2));
};

const overlapRatio = (query: Set<string>, target: Set<string>): number => {
  if (query.size === 0 || target.size === 0) {
    return 0;
  }

  let hits = 0;
  for (const token of query) {
    if (target.has(token)) {
      hits += 1;
    }
  }
  return hits / query.size;
};

const jaccardSimilarity = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const computeRecencyByCandidate = (candidates: ImageSelectionCandidate[]): Map<string, number> => {
  const values = candidates.map((candidate) => candidate.modifiedAtMs);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);

  const byPath = new Map<string, number>();
  for (const candidate of candidates) {
    const normalized = (candidate.modifiedAtMs - min) / range;
    byPath.set(candidate.relativePath, Math.max(0, Math.min(1, normalized)));
  }
  return byPath;
};

const hasBlockedSafety = (safety: CandidateSafety): boolean => {
  for (const value of Object.values(safety)) {
    if (SAFE_BLOCK_LEVELS.has(String(value).toLowerCase())) {
      return true;
    }
  }
  return false;
};

const computeSafetyPenalty = (safety: CandidateSafety): number => {
  for (const value of Object.values(safety)) {
    if (SAFE_PENALTY_LEVELS.has(String(value).toLowerCase())) {
      return 0.2;
    }
  }
  return 0;
};

const buildClusterKey = (candidate: ImageSelectionCandidate): string => {
  if (candidate.sceneTags.length > 0) {
    return candidate.sceneTags
      .slice(0, 3)
      .map((entry) => normalizeTokenSource(entry))
      .filter(Boolean)
      .join("|");
  }
  if (candidate.fileContentHash) {
    return `hash:${candidate.fileContentHash.slice(0, 16)}`;
  }
  return `path:${candidate.relativePath}`;
};

const byDeterministicOrder = (left: RankedCandidate, right: RankedCandidate): number => {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  if (right.modifiedAtMs !== left.modifiedAtMs) {
    return right.modifiedAtMs - left.modifiedAtMs;
  }
  return left.relativePath.localeCompare(right.relativePath);
};

type RankedCandidate = ImageSelectionCandidate & {
  score: number;
  clusterKey: string;
};

const applyDiversityGuard = (ranked: RankedCandidate[], requiredCount: number): RankedCandidate[] => {
  const selected: RankedCandidate[] = [];
  const clusterCount = new Map<string, number>();
  const queue = [...ranked];

  // First pass: cap one image per cluster.
  for (const candidate of queue) {
    if (selected.length >= requiredCount) {
      break;
    }
    const count = clusterCount.get(candidate.clusterKey) ?? 0;
    if (count >= 1) {
      continue;
    }
    selected.push(candidate);
    clusterCount.set(candidate.clusterKey, count + 1);
  }

  if (selected.length >= requiredCount) {
    return selected;
  }

  // Second pass: fill remaining slots while respecting deterministic ordering.
  for (const candidate of queue) {
    if (selected.length >= requiredCount) {
      break;
    }
    if (selected.some((entry) => entry.fileId === candidate.fileId)) {
      continue;
    }
    selected.push(candidate);
  }

  return selected;
};

export const rankAndSelectCandidates = (params: {
  queryText: string;
  requiredCount: number;
  candidates: ImageSelectionCandidate[];
}): ImageSelectionCandidate[] => {
  const requiredCount = Math.max(1, Math.min(4, params.requiredCount));
  const candidates = params.candidates.filter((candidate) => !hasBlockedSafety(candidate.safety));
  if (candidates.length === 0) {
    return [];
  }

  const queryTokens = toTokenSet(params.queryText);
  const recencyByPath = computeRecencyByCandidate(candidates);

  const ranked = candidates
    .map((candidate) => {
      const candidateTokens = toTokenSet(candidate.searchText);
      const semantic = jaccardSimilarity(queryTokens, candidateTokens);
      const keyword = overlapRatio(queryTokens, candidateTokens);
      const recency = recencyByPath.get(candidate.relativePath) ?? 0;
      const safetyPenalty = computeSafetyPenalty(candidate.safety);

      const score = 0.55 * semantic + 0.3 * keyword + 0.15 * recency - safetyPenalty;
      return {
        ...candidate,
        score,
        clusterKey: buildClusterKey(candidate)
      };
    })
    .sort(byDeterministicOrder);

  return applyDiversityGuard(ranked, requiredCount).map((entry) => ({
    fileId: entry.fileId,
    fileName: entry.fileName,
    relativePath: entry.relativePath,
    fileSize: entry.fileSize,
    detectedAt: entry.detectedAt,
    modifiedAtMs: entry.modifiedAtMs,
    searchText: entry.searchText,
    sceneTags: entry.sceneTags,
    safety: entry.safety,
    fileContentHash: entry.fileContentHash
  }));
};
