import { Key } from "@514labs/moose-lib/browserCompatible";

export enum GitHubEventType {
  Watch = "WatchEvent",
  Push = "PushEvent",
  Issue = "IssuesEvent",
  IssueComment = "IssueCommentEvent",
  PullRequest = "PullRequestEvent",
  PullRequestReview = "PullRequestReviewEvent",
  Create = "CreateEvent",
  Delete = "DeleteEvent",
  PRComment = "PullRequestReviewCommentEvent",
  Fork = "ForkEvent",
  Member = "MemberEvent",
  Release = "ReleaseEvent",
}

export interface IGhEvent {
  eventType: string;
  eventId: Key<string>;
  createdAt: Date;
  actorLogin: string;
  actorId: number;
  actorUrl: string;
  actorAvatarUrl: string;
  repoUrl: string;
  repoId: number;
  repoOwner: string;
  repoName: string;
  repoFullName: string;
}

export interface IRepoStarEvent extends IGhEvent {
  repoDescription: string;
  repoTopics: string[];
  repoLanguage: string;
  repoStars: number;
  repoForks: number;
  repoWatchers: number;
  repoOpenIssues: number;
  repoCreatedAt: Date;
  repoOwnerLogin: string;
  repoOwnerId: number;
  repoOwnerUrl: string;
  repoOwnerAvatarUrl: string;
  repoOwnerType: string;
  repoOrgId: number;
  repoOrgUrl: string;
  repoOrgLogin: string;
  repoHomepage: string;
}
