import { appendFileSync, readFileSync } from "node:fs";

const repository = process.env.GITHUB_REPOSITORY;
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY: set owner/repository for release selection.");
if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN: provide the workflow's GitHub token for release verification.");
if (!process.env.GITHUB_EVENT_PATH) throw new Error("GITHUB_EVENT_PATH: provide the GitHub event file.");
if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT: provide the workflow step output file.");
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
const name = process.env.GITHUB_EVENT_NAME;
const tag = name === "workflow_run" ? event.workflow_run?.head_branch
  : name === "release" ? event.release?.tag_name : name === "workflow_dispatch" ? event.inputs?.release_tag : undefined;
if (typeof tag !== "string" || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error("Select a published vMAJOR.MINOR.PATCH release.");

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(30_000), redirect: "error",
  });
  if (!response.ok) throw new Error(`GitHub release verification failed for ${path} (HTTP ${response.status}).`);
  return response.json();
}
const release = await api(`releases/tags/${tag}`);
if (release.draft || release.prerelease) throw new Error("Cloudflare production accepts published stable releases only.");
const latest = await api("releases/latest");
if (latest.tag_name !== tag) {
  appendFileSync(process.env.GITHUB_OUTPUT, "deploy=false\n");
  console.log(`${tag} is not the latest published release. Leaving Cloudflare unchanged.`);
  process.exit(0);
}
let object = (await api(`git/ref/tags/${tag}`)).object;
for (let depth = 0; object?.type === "tag" && depth < 5; depth++) object = (await api(`git/tags/${object.sha}`)).object;
if (object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha)) throw new Error("The release tag must resolve to a commit.");
const sha = object.sha;
if (name === "workflow_run" && (event.workflow_run.conclusion !== "success" || event.workflow_run.event !== "push" || event.workflow_run.head_sha !== sha || event.workflow_run.head_repository?.full_name !== repository)) {
  throw new Error("The completed workflow does not match this repository's successful release commit.");
}
const runs = await api(`actions/workflows/ci-release.yml/runs?event=push&status=success&head_sha=${sha}&branch=${tag}&per_page=100`);
if (!runs.workflow_runs?.some(run => run.head_sha === sha && run.head_branch === tag && run.event === "push" && run.conclusion === "success")) {
  throw new Error(`The ${tag} release workflow has not passed. Cloudflare is unchanged.`);
}
appendFileSync(process.env.GITHUB_OUTPUT, `deploy=true\ntag=${tag}\nsha=${sha}\n`);
console.log(`Verified published release ${tag} at ${sha}, with successful release gates.`);
