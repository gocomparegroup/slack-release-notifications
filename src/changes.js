// SPDX-FileCopyrightText: 2021 Future PLC
//
// SPDX-License-Identifier: BSD-2-Clause

const fetch = require("node-fetch");
const core    = require("@actions/core");

// A ticket name is any valid project name followed by a non-zero padded
// number, with an optional non-alphanumeric seperator.
// The seperator will be normalised to a hyphen.
const ticketRegexp = /(FR|MVC|REV|WL|OPS|MVO|ELO|SRE|HAWK)[^0-9A-Za-z]?([1-9][0-9]*)/gim;

class Change
{
    constructor(ticket)
    {
        this.ticket = ticket;
        this.summary = "";
        this.status = "";
        this.link = "https://purch1.atlassian.net/browse/" + ticket;
        this.commits = 0;
        this.message = [];
        this.prs = [];
    }
}

/**
 *
 * @param {Object.<string, Change>} changeList
 * @return {Promise<void>}
 */
async function addTicketDetailsToChanges(changeList)
{
    "use strict";

    const changes = Object.entries(changeList);

    await Promise.all(changes.map(async ([key, change]) => {
        if (key === "other") {
            change.summary = "Miscellaneous Changes";
            change.status  = "Unknown";
            return;
        }

		await fillTicketDataPurchJira(key, change);
    }));
}

/**
 *
 * @param {!string} key
 * @param {!Change} change
 *
 * @return {!Change}
 */
async function fillTicketDataPurchJira(key, change) {
    const url = new URL("https://purch1.atlassian.net/rest/api/3/issue/" + key + "?fields=summary,status");

    const response = await fetch(url, {
        method: "GET",
        headers: {"Authorization": "Basic " + core.getInput("jiraToken")},
    });

    if (response.status !== 200) {
        return;
    }

    const data = await response.json();

    change.link    = "https://purch1.atlassian.net/browse/" + key;
    change.summary = data.fields.summary;
    change.status  = data.fields.status.name;
}

/**
 * Groups a series of commit's messages by the first ticket number mentioned
 * in the message, and sorts that list by the number of commits per ticket.
 *
 * @param {Object[]} history
 * @return {Promise<Object.<string, Change>>}
 */
async function groupHistoryAsChanges(history)
{
    "use strict";

    /** @type {Object.<string, Change>} */
    const changeMap = {};

    for await (let commit of history) {
        /** @type {string} */
        let message = commit.commit.message;
        /** @type {boolean} */
        let hasPreviousTicket = false;

        let matches;

        // Search the commit message for all things that look like a ticket
        while ((matches = ticketRegexp.exec(message))) {
            // Extract and combine the project name and ticket number.
            // This allows for things like "MVC 3801", "MVC-3801", and
            // "MVC_3801" to all work
            let ticket = matches[1] + "-" + matches[2];
            ticket = ticket.toUpperCase();

            // Add this commit's information to the changelog.
            // If this is the first ticket referenced in the commit, then
            // the commit is assigned to that ticket; others are treated
            // as secondary references.
            processCommit(changeMap, ticket, message, !hasPreviousTicket);
            hasPreviousTicket = true;
        }

        // If there is no ticket mentioned in the commit, we add it to
        // the 'others' category
        if (!hasPreviousTicket) {
            processCommit(changeMap, "other", message, true);
        }
    }

    return changeMap;
}

/**
 *
 * @param {Object.<string, Change>} changeMap
 * @return {Change[]}
 */
function sortChangesBySize(changeMap)
{
    "use strict";

    /**
	 * Get the list of unique tickets
	 *
	 * @type {Change[]}
	 */
    let changes = Object.values(changeMap);

    // Sort the array from most comment lines to fewest.
    // 'other' is forcibly sorted to the end, and a last case
    // comparison of the ticket key is used.
    changes.sort((a, b) =>
        (b.message.length - (b.ticket === "other") * 1000) -
		(a.message.length - (a.ticket === "other") * 1000) ||
		a.ticket.localeCompare(b.ticket)
    );

    return changes;
}

/**
 *
 * @param changes {Object.<string, Change>}
 * @param ticket {string}
 * @param message {string}
 * @param first {boolean}
 */
function processCommit(changes, ticket, message, first)
{
    "use strict";

    let lines = [];
    let cont  = false;
    let line;

    const prMergeRegexp  = /^Merge pull request #([1-9][0-9]*)/;
    const branchMergeRegexp  = /^Merge branch '[^' ]+' into/;

    if (! (ticket in changes))
    {
        changes[ticket] = new Change(ticket);
    }

    changes[ticket].commits++;

    if (! first)
    {
        return;
    }

    for (line of message.replace("\r", "").split("\n"))
    {
        // Remove the ticket key from the line, and trim off any whitespace
        line = line.replace(ticketRegexp, "").trim();

        // Blank lines can be ignored, but a split line can not be continued
        // if we come across a blank line.
        if (line === "")
        {
            cont = false;
            continue;
        }

        // Github generates a very boring commit message line when it merges
        // a pull request. We will remove that line, but take a note of the
        // pull request number.
        if (prMergeRegexp.test(line))
        {
            let pr_data = prMergeRegexp.exec(line);
            changes[ticket].prs.push(pr_data[1]);
            continue;
        }

        if (branchMergeRegexp.test(line))
        {
            continue;
        }

        // Sometimes, Github truncates the first line of a commit message
        // when merging it into another place via its interface.
        // We can check to see if we have the original commit message to hand
        // And silently update this line to that value.
        if (line.endsWith("…"))
        {
            let ref = line.substring(0, line.length - 1).replace(/^[#\-*]/, "").trim();

            for (let existingLine of changes[ticket].message)
            {
                if (existingLine.startsWith(ref))
                {
                    line = existingLine;
                    break;
                }
            }
        }

        // If we begin with a letter of a number, and we can continue an
        // existing line, we merge this line into the previous line.
        if (cont && /^[A-Za-z0-9]/.test(line))
        {
            lines[lines.length - 1] += " " + line;
            continue;
        }

        // Otherwise, remove common bullet marks from the front of string
        // and add it as a new line
        lines[lines.length] = line.replace(/^[#\-*:]/, "").trim();
        cont = true;
    }

    Array.prototype.push.apply(changes[ticket].message, lines);
}

/**
 * @param {Change[]} changes
 */
function generateChangelog(changes)
{
    "use strict";

    /**
	 * @var {Change}
	 */
    let change;
    /**
	 * @var {string}
	 */
    let changelog = "";

    // Build out the changelog
    // =======================

    // Then, we create a sub-block for each of the tickets we have found.
    for (change of changes)
    {
        if (change.ticket !== "other")
        {
            changelog += "* " + change.summary;

            // Add the ticket reference and any PR number to the end of
            // the ender line
            change.prs.unshift(change.ticket);
            changelog += ": [" + change.prs.map(p => "PR#" + p).join(" ") + "]\n";

            // Add the lines of commit messages to beneath
            changelog += "  - " + change.message.unique().join("\n  - ") + "\n\n";
        }
        else
        {
            // The otther section is just one bullet per message
            changelog += "* " + change.message.unique().join("\n* ") + "\n";
        }
    }

    changelog  = changelog.trim();

    return changelog;
}

module.exports.addTicketDetailsToChanges = addTicketDetailsToChanges;
module.exports.groupHistoryAsChanges = groupHistoryAsChanges;
module.exports.sortChangesBySize = sortChangesBySize;
module.exports.generateChangelog = generateChangelog;
