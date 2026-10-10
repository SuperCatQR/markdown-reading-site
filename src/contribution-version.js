// Include both immutable files and the release identity. Body/reference views
// share navigation evidence but keep separate feedback drafts.
export function contributionVersion(entry) {
  return JSON.stringify([entry.manuscriptType, entry.editionId, entry.aiRevisionId,
    entry.contentSha256, entry.artifactSha256, entry.reviewArtifactSha256, entry.releaseId || ""]);
}
