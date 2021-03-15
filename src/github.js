// SPDX-FileCopyrightText: 2021 Future PLC
//
// SPDX-License-Identifier: BSD-2-Clause

const core  = require("@actions/core");
const fetch = require("node-fetch");

/**
 * @param {Config} config
 * @param {URL} baseUrl
 * @param {Object.<string, string>} query
 */
function github(config, baseUrl, query)
{
    "use strict";

    const url = new URL("", baseUrl);

    Object.keys(query).forEach(k => {
        url.searchParams.append(k, query[k]);
    });

    const request = new fetch.Request(url, {
        "headers": {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": "Token " + config.githubToken
        }
    });

    return fetch(request).then(r => r.json());
}

/**
 * @param {Config} config
 * @param {URL} url
 * @param {Object|Array} data
 */
function patch(config, url, data)
{
    "use strict";

    const request = new fetch.Request(url, {
        "method": "PATCH",
        "headers": {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": "Token " + config.githubToken,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
    });

    return fetch(request).then(r => r.json()).catch(e => core.error(e));
}

/**
 * @param {Config} config
 * @param {Number} prNumber
 * @return {Promise<*>}
 */
async function getPR(config, prNumber) {
    return github(config, new URL("pulls/" + prNumber, config.apiUrl), {});
}


/**
 * @param {Config} config
 * @param {Number} prNumber
 * @return {Promise<Object[]>}
 */
async function getCommitHistoryForPR(config, prNumber)
{
    let page = 0;
    let commitsOnPage;
    let history = [];

    do {
        ++page;

        commitsOnPage = await github(
            config,
            new URL("pulls/" + prNumber + "/commits", config.apiUrl),
            {"page": page, "per_page": 100}
        );

        console.log(commitsOnPage);

        history.push(...commitsOnPage);
    } while (commitsOnPage.length);

    return history;
}

module.exports.getPR = getPR;
module.exports.getCommitHistoryForPR = getCommitHistoryForPR;
module.exports.patch = patch;
