// SPDX-FileCopyrightText: 2021 Future PLC
//
// SPDX-License-Identifier: BSD-2-Clause

"use strict";

const slack = require("@slack/webhook");

class SlackMessage {
  /**
   * @param {string} token
   * @param {string} fallbackMessage
   */
  constructor(token, fallbackMessage) {
    this.token = token;
    this.message = fallbackMessage;
    /** @type {SlackBlock[]} */
    this.blocks = [];
  }

  /**
   *
   * @param {SlackBlock} block
   * @return {SlackMessage}
   */
  addBlocks(...block) {
    this.blocks.push(...block);

    return this;
  }

  toJson() {
    return {
      text: this.message,
      blocks: this.blocks.map((x) => x.toJson()),
    };
  }

  send() {
    const webhook = new slack.IncomingWebhook(this.token);
    return webhook.send(this.toJson());
  }
}

class SlackBlock {
  constructor() {
    this.data = {};
  }

  toJson() {
    return this.data;
  }

  get supportsAccessory() {
    return false;
  }

  addButtonAccessory(url, text) {
    if (!this.supportsAccessory) {
      throw "This block does not support accessories";
    }

    this.data.accessory = {
      type: "button",
      url: url,
      text: {
        type: "plain_text",
        text: text,
        emoji: true,
      },
    };

    return this;
  }

  addField(text) {
    if (!this.supportsFields) {
      throw "This block does not support accessories";
    }

    if (!Object.hasOwnProperty.call(this.data, "fields")) {
      this.data.fields = [];
    }

    this.data.fields.push({ type: "mrkdwn", text: text });

    return this;
  }
}

class HeaderBlock extends SlackBlock {
  constructor(text) {
    super();

    this.data.type = "section";
    this.data.text = {
      type: "plain_text",
      text: text,
      emoji: true,
    };
  }

  get supportsAccessory() {
    return true;
  }
}

class TextBlock extends SlackBlock {
  constructor(text) {
    super();

    this.data.type = "section";

    if (text) {
      this.data.text = {
        type: "mrkdwn",
        text: text,
      };
    }
  }

  get supportsAccessory() {
    return true;
  }

  get supportsFields() {
    return true;
  }
}

class Divider extends SlackBlock {
  constructor() {
    super();

    this.data.type = "divider";
  }
}

module.exports.SlackMessage = SlackMessage;
module.exports.HeaderBlock = HeaderBlock;
module.exports.TextBlock = TextBlock;
module.exports.Divider = Divider;
