import {Context, Robot} from "probot";
import {OctokitWithPagination} from "probot/lib/github";
import {PullRequest, ReposCreateStatusParams} from "@octokit/rest";
import {STATUS_STATE} from "../typings";

export class Task {
  repositories: FirebaseFirestore.CollectionReference;
  pullRequests: FirebaseFirestore.CollectionReference;
  admin: FirebaseFirestore.CollectionReference;

  constructor(public robot: Robot, public db: FirebaseFirestore.Firestore) {
    this.repositories = this.db.collection('repositories');
    this.pullRequests = this.db.collection('pullRequests');
    this.admin = this.db.collection('admin');
  }

  /**
   * Gets the PR data from Github (or parameter) and adds/updates it in Firebase
   */
  async updateDbPR(github: OctokitWithPagination, owner: string, repo: string, number: number, repositoryId: number, newData?: any): Promise<any> {
    newData = newData || (await github.pullRequests.get({owner, repo, number})).data;
    const data = {...newData, repository: {owner, name: repo, id: repositoryId}};
    const doc = this.pullRequests.doc(data.id.toString());
    await doc.set(data, {merge: true}).catch(err => {
      this.robot.log.error(err);
      throw err;
    });
    return (await doc.get()).data();
  }

  /**
   * Sets the status on the target PR
   */
  async setStatus(state: STATUS_STATE, desc: string, statusContext: string, context: Context): Promise<void> {
    const {owner, repo} = context.repo();

    const statusParams: ReposCreateStatusParams = {
      owner,
      repo,
      sha: context.payload.sha,
      context: statusContext,
      state,
      description: desc,
    };

    await context.github.repos.createStatus(statusParams);
  }

  /**
   * Finds a PR that's previously been processed by the bot
   */
  async findPrBySha(sha: string, repositoryId: number): Promise<PullRequest> {
    let pr: PullRequest;
    const matches = (await this.pullRequests.where('head.sha', '==', sha)
      .where('repository.id', '==', repositoryId)
      .get());
    matches.forEach(async doc => {
      pr = doc.data() as any;
    });
    return pr;
  }

  // wrapper for this.robot.on
  dispatch(events: string | string[], callback: (context: Context) => any) {
    this.robot.on(events, (context: any) => {
      this.log({context}, "Event received");
      return callback(context);
    });
  }

  log(...content: any[]) {
    this.robot.log.info(...content);
  }

  logInfo(...content: any[]) {
    this.log(...content);
  }

  logError(...content: any[]) {
    this.robot.log.error(...content);
  }

  logWarn(...content: any[]) {
    this.robot.log.warn(...content);
  }

  logDebug(...content: any[]) {
    this.robot.log.debug(...content);
  }

  /**
   * Returns the GraphQL node_id for a resource
   * @param resource the resource for which you want to get the node_id (eg: issue, or pull_request)
   * @returns {Promise<any>}
   */
  async node(context: Context, resource: any) {
    // GraphQL query to get Node id for any resource, which is needed for mutations
    const getResource = `
    query getResource($url: URI!) {
      resource(url: $url) {
        ... on Node {
          id
        }
      }
    }
  `;

    return context.github.query(getResource, {url: resource.html_url});
  }

  async queryPR<T>(context: Context, query: string, params: { [key: string]: any, owner: string, repo: string, number: number }): Promise<T> {
    return (await context.github.query(`query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          ${query}
        }
      }
    }`, params) as any).repository.pullRequest;
  }
}
