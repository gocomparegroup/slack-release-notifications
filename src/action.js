// SPDX-FileCopyrightText: 2021 Future PLC
//
// SPDX-License-Identifier: BSD-2-Clause

const core    = require("@actions/core");
const slack   = require("./slack");
const github  = require("./github");
const changeset = require("./changes");

// Removes duplicate entries in an array
Array.prototype.unique = function() {
    return this.filter((v, i, self) => self.indexOf(v) === i);
};

class Config
{
    constructor(apiUrl, githubToken, slackToken, repo, ref) {
        this.apiUrl = apiUrl;
        this.githubToken = githubToken;
        this.slackToken = slackToken;
        this.repo = repo;
        this.ref = ref;
    }
}

async function main()
{
    const config = new Config(
        process.env.GITHUB_API_URL,
        core.getInput("githubToken"),
        core.getInput("slackToken"),
        process.env.GITHUB_REPOSITORY,
        process.env.GITHUB_REF
    );

    const action = core.getInput("action");

    core.warning("Action = " + action);

    if (action === "new-release") {
        const prNumber = parseInt(config.ref.split("/")[2]);
        core.warning("announceNewReleasePR(" + prNumber +")");
        return await announceNewReleasePR(config, prNumber);
    } else if (action === "deploy-start") {
        const prNumber = parseInt(config.ref.split("/")[2]);
        core.warning("announceDeploymentStart(" + prNumber +")");
        return await announceDeploymentStart(config, prNumber);
    } else if (action === "deploy-complete") {
        const prNumber = parseInt(config.ref.split("/")[2]);
        core.warning("announceDeploymentComplete(" + prNumber +")");
        return await announceDeploymentComplete(config, prNumber);
    } else {
        core.error("Invalid action " + action);
    }
}

/**
 *
 * @param {Config} config
 * @param {int} prNumber
 * @return {Promise<void>}
 */
async function announceNewReleasePR(config, prNumber)
{
    core.warning("github.getPR(" + prNumber +")");
    const pr = await github.getPR(config, prNumber);
    core.warning("github.getCommitHistoryForPR(" + prNumber +")");
    const history = await github.getCommitHistoryForPR(config, prNumber);
    core.warning("github.groupHistoryAsChanges([" + history.length +"])");
    const changeList = await changeset.groupHistoryAsChanges(history);

    core.warning("changeset.addTicketDetailsToChanges([" + changeList.length +"])");
    await changeset.addTicketDetailsToChanges(changeList);
    core.warning("changeset.sortChangesBySize()");
    const changes = changeset.sortChangesBySize(changeList);

    core.warning("prepareSlackMessage");
    const message = prepareSlackMessage(config, pr, changes);
    await message.send();

    core.warning("changeset.generateChangelog");
    const changelog = changeset.generateChangelog(changes);
    await github.patch(config, new URL("pulls/" + prNumber, config.apiUrl), {"body": changelog});
}

function prepareSlackMessage(config, pr, changes) {
    const message = new slack.SlackMessage(config.slackToken, "New FEv2 Release proposed in PR #" + pr.number);

    message.addBlocks(
        new slack.TextBlock("A new *FEv2* production release has been proposed in PR #" + pr.number),
        new slack.HeaderBlock(pr.title),
        new slack.TextBlock(null)
            .addButtonAccessory(prUrl(config, pr.number), "View PR")
            .addField(changes.length + " Tickets")
            .addField(changes.map(change => change.commits.length).reduce((a, v) => a + v, 0) + " Commits"),
        new slack.Divider(),
        ...changes.map(change =>
            new slack.TextBlock(
                `<${ticketUrl(change.ticket)}}|${change.ticket}> *[${change.status}]* ${change.summary} ` +
                change.prs.map(pr => `<${prUrl(config, pr)}|#${pr}>`).join(", ")
            ).addButtonAccessory(ticketUrl(change.ticket), "View")
        )
    );

    return message;
}

/**
 *
 * @param {Config} config
 * @param {int} prNumber
 * @return {Promise<void>}
 */
async function announceDeploymentStart(config, prNumber)
{
    const pr = await github.getPR(config, prNumber);
    const message = new slack.SlackMessage(config.slackToken, "New FEv2 Release proposed in PR #" + pr.number);

    message.addBlocks(
        new slack.TextBlock(`*FEv2*: production deployment <${prUrl(config, prNumber)}|PR#${pr.number}> started.`)
    );

    await message.send();
}

/**
 *
 * @param {Config} config
 * @param {int} prNumber
 * @return {Promise<void>}
 */
async function announceDeploymentComplete(config, prNumber)
{
    const pr = await github.getPR(config, prNumber);
    const message = new slack.SlackMessage(config.slackToken, "New FEv2 Release proposed in PR #" + pr.number);

    message.addBlocks(
        new slack.TextBlock(`*FEv2*: production deployment <${prUrl(config, prNumber)}|PR#${pr.number}> completed.`)
    );

    await message.send();
}

/**
 *
 * @param {string} ticket
 * @return {string}
 */
function ticketUrl(ticket) {
    return "https://myvouchercodes.atlassian.net/browse/" + ticket;
}

/**
 * @param {Config} config
 * @param {Number} prNumber
 * @return {string}
 */
function prUrl(config, prNumber) {
    return "https://github.com/" + config.repo + "/pull/" + prNumber;
}


main().catch(error => core.setFailed(error.message));
