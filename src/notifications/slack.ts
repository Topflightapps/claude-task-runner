import { getConfig } from "../config.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger("slack");

export async function notifySlack(
  prTitle: string,
  prUrl: string,
  commentCount: number,
): Promise<void> {
  const config = getConfig();
  if (!config.SLACK_WEBHOOK_URL) {
    log.debug("No SLACK_WEBHOOK_URL configured, skipping notification");
    return;
  }

  const payload = {
    blocks: [
      {
        text: {
          text: "*PR Review Ready* :eyes:",
          type: "mrkdwn",
        },
        type: "section",
      },
      {
        text: {
          text:
            "*<" +
            prUrl +
            "|" +
            prTitle +
            ">*\n" +
            String(commentCount) +
            " comment" +
            (commentCount === 1 ? "" : "s") +
            " pending your approval",
          type: "mrkdwn",
        },
        type: "section",
      },
    ],
  };

  try {
    const response = await fetch(config.SLACK_WEBHOOK_URL, {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    if (!response.ok) {
      log.error(
        { status: response.status },
        "Slack webhook returned non-OK status",
      );
    } else {
      log.info({ prUrl }, "Slack notification sent");
    }
  } catch (err) {
    log.error(err, "Failed to send Slack notification");
  }
}
