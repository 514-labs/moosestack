import { Task, Workflow } from "@514labs/moose-lib";
import { createOctokit, getMooseUrl } from "../../utils";

const fetchEvents = new Task<null, void>("fetchEvents", {
  run: async () => {
    const octokit = createOctokit();
    const mooseUrl = getMooseUrl();

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
  },
  retries: 3,
  timeout: "1h",
});

export const getGithubEventsWorkflow = new Workflow("getGithubEvents", {
  startingTask: fetchEvents,
  schedule: "* * * * *",
  retries: 3,
  timeout: "1h",
});
