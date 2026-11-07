import type { ApiProblem, StoryDto } from "../../services/index.ts";

/**
 * The story as it is now, from a 409 story_changed (plan §5.1). The story service keeps `current` only when it is a
 * story it could read (the real one checks it with the API's schema), so it is used as it is.
 */
export function currentStory(problem: ApiProblem): StoryDto | undefined {
  if (problem.kind !== "answer" || problem.code !== "story_changed" || problem.current === undefined) return undefined;
  return problem.current as StoryDto;
}
