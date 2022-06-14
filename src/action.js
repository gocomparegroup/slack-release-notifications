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
    constructor(deployee, apiUrl, githubToken, slackToken, repo, ref) {
        this.deployee = deployee;
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
        core.getInput("name"),
        process.env.GITHUB_API_URL,
        core.getInput("githubToken"),
        core.getInput("slackToken"),
        process.env.GITHUB_REPOSITORY,
        process.env.GITHUB_REF
    );

    const action = core.getInput("action");

    console.log("Action = " + action);

    if (action === "new-release") {
        const prNumber = parseInt(config.ref.split("/")[2]);
        console.log("announceNewReleasePR(" + prNumber +")");
        return await announceNewReleasePR(config, prNumber);
    } else if (action === "deploy-start") {
        console.log("announceDeploymentStart()");
        return await announceDeploymentStart(config);
    } else if (action === "deploy-complete") {
        console.log("announceDeploymentComplete()");
        return await announceDeploymentComplete(config);
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
    console.log("github.getPR(" + prNumber +")");
    const pr = await github.getPR(config, prNumber);
    console.log("github.getCommitHistoryForPR(" + prNumber +")");
    const history = await github.getCommitHistoryForPR(config, prNumber);
    console.log("github.groupHistoryAsChanges([" + history.length +"])");
    const changeList = await changeset.groupHistoryAsChanges(history);

    console.log("changeset.addTicketDetailsToChanges([" + changeList.length +"])");
    await changeset.addTicketDetailsToChanges(changeList);
    console.log("changeset.sortChangesBySize()");
    const changes = changeset.sortChangesBySize(changeList);

    console.log("prepareSlackMessage");
    const message = prepareSlackMessage(config, pr, changes);
    await message.send();

    console.log("changeset.generateChangelog");
    const changelog = changeset.generateChangelog(changes);
    await github.patch(config, new URL("pulls/" + prNumber, config.apiUrl), {"body": changelog});
}

function prepareSlackMessage(config, pr, changes) {
    const message = new slack.SlackMessage(config.slackToken, `New ${config.deployee} Release proposed in PR #${pr.number}`);

    message.addBlocks(
        new slack.TextBlock(`A new *${config.deployee}* production release has been proposed in PR #${pr.number}`),
        new slack.HeaderBlock(pr.title),
        new slack.TextBlock(null)
            .addButtonAccessory(prUrl(config, pr.number), "View PR")
            .addField(changes.length + " Tickets")
            .addField(changes.map(change => change.commits).reduce((a, v) => a + v, 0) + " Commits"),
        new slack.Divider(),
        ...changes.map(change =>
            new slack.TextBlock(
                `<${ticketUrl(change.ticket)}}|${change.ticket}> *[${change.status}]* ${change.summary} ` +
                change.prs.map(pr => `<${prUrl(config, pr)}|${pr}>`).join(", ")
            ).addButtonAccessory(ticketUrl(change.ticket), "View")
        )
    );

    return message;
}

/**
 *
 * @param {Config} config
 * @return {Promise<void>}
 */
async function announceDeploymentStart(config)
{
    const message = new slack.SlackMessage(config.slackToken, `*${config.deployee}*: production deployment started.`);

    message.addBlocks(
        new slack.TextBlock(`*${config.deployee}*: production deployment started.`)
    );

    await message.send();
}

/**
 *
 * @param {Config} config
 * @return {Promise<void>}
 */
async function announceDeploymentComplete(config)
{
    const message = new slack.SlackMessage(config.slackToken, `*${config.deployee}*: production deployment completed.`);

    message.addBlocks(
        new slack.TextBlock(`*${config.deployee}*: production deployment completed.`)
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


main().catch(error => {console.log(error); core.setFailed(error.message);});
