import { TaskFunction, TaskDefinition } from "@514labs/moose-lib";
import { createOctokit, getMooseUrl } from "../../utils";

const octokit = createOctokit();
const mooseUrl = getMooseUrl();

// The initial input data and data passed between tasks can be
// defined in the task function parameter
const load: TaskFunction = async (input?: any) => {
  const responses = await octokit.paginate.iterator(
    octokit.activity.listPublicEvents,
    {
      per_page: 100,
    },
  );

  for await (const response of responses) {
    for (const event of response.data) {
      const ghEvent = {
        eventType: event.type,
        eventId: event.id,
        actorLogin: event.actor.login,
        actorId: event.actor.id,
        actorUrl: event.actor.url,
        actorAvatarUrl: event.actor.avatar_url,
        repoFullName: event.repo.name,
        repoOwner: event.repo.name.split("/")[0],
        repoName: event.repo.name.split("/")[1],
        repoUrl: event.repo.url,
        repoId: event.repo.id,
        createdAt: event.created_at ? new Date(event.created_at) : new Date(),
      };

      await fetch(`${mooseUrl}/ingest/GhEvent`, {
        method: "POST",
        body: JSON.stringify(ghEvent),
      });
    }
  }

  return {
    task: "load",
    data: {},
  };
};

export default function createTask() {
  return {
    task: load,
    config: {
      retries: 3,
    },
  } as TaskDefinition;
}
