import { getConfig } from "../config.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("slack");

export async function notifySlack(
  prTitle: string,
  prUrl: string,
  commentCount: number,
): Promise<void> {
  const config = getConfig();
  if (!config.SLACK_BOT_TOKEN || !config.SLACK_USER_ID) {
    log.debug(
      "SLACK_BOT_TOKEN or SLACK_USER_ID not configured, skipping notification",
    );
    return;
  }

  const text =
    "*PR Review Ready* :eyes:\n" +
    "*<" +
    prUrl +
    "|" +
    prTitle +
    ">*\n" +
    String(commentCount) +
    " comment" +
    (commentCount === 1 ? "" : "s") +
    " pending your approval";

  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      body: JSON.stringify({
        channel: config.SLACK_USER_ID,
        mrkdwn: true,
        text,
      }),
      headers: {
        Authorization: "Bearer " + config.SLACK_BOT_TOKEN,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = (await response.json()) as { error?: string; ok: boolean };

    if (!result.ok) {
      log.error({ error: result.error }, "Slack API returned error");
    } else {
      log.info({ prUrl }, "Slack DM notification sent");
    }
  } catch (err) {
    log.error(err, "Failed to send Slack notification");
  }
}
