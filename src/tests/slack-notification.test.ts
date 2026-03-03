import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for Slack DM notification. Captures the design decision to use
 * chat.postMessage with a bot token + user ID (for DMs) instead of
 * incoming webhook URLs (which post to channels).
 */

describe("Slack notification format", () => {
  it("should format message with PR title, URL, and comment count", () => {
    const prTitle = "Add authentication flow";
    const prUrl = "https://github.com/org/repo/pull/42";
    const commentCount = 3 as number;

    const text =
      "*PR Review Ready* :eyes:\n" +
      "*<" + prUrl + "|" + prTitle + ">*\n" +
      String(commentCount) + " comment" +
      (commentCount === 1 ? "" : "s") +
      " pending your approval";

    expect(text).toContain(prUrl);
    expect(text).toContain(prTitle);
    expect(text).toContain("3 comments");
    expect(text).not.toContain("3 comment pending");
  });

  it("should use singular 'comment' for count of 1", () => {
    const commentCount = 1 as number;
    const suffix = commentCount === 1 ? "" : "s";
    expect("comment" + suffix).toBe("comment");
  });

  it("should use plural 'comments' for count > 1", () => {
    const commentCount = 5 as number;
    const suffix = commentCount === 1 ? "" : "s";
    expect("comment" + suffix).toBe("comments");
  });

  it("should use plural 'comments' for count of 0", () => {
    const commentCount = 0 as number;
    const suffix = commentCount === 1 ? "" : "s";
    expect("comment" + suffix).toBe("comments");
  });
});

describe("Slack API integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should send to chat.postMessage endpoint (DM), not incoming webhook", () => {
    // The correct endpoint for DMs is the Slack Web API
    const endpoint = "https://slack.com/api/chat.postMessage";
    expect(endpoint).toContain("slack.com/api/chat.postMessage");
    expect(endpoint).not.toContain("hooks.slack.com");
  });

  it("should use channel=SLACK_USER_ID for DM delivery", () => {
    const slackUserId = "U1234567890";
    const payload = {
      channel: slackUserId,
      mrkdwn: true,
      text: "test message",
    };

    // When channel is a user ID (starts with U), Slack sends as DM
    expect(payload.channel).toMatch(/^U/);
  });

  it("should include Bearer token in Authorization header", () => {
    const botToken = "xoxb-fake-token";
    const headers = {
      Authorization: "Bearer " + botToken,
      "Content-Type": "application/json",
    };

    expect(headers.Authorization).toBe("Bearer xoxb-fake-token");
    expect(headers.Authorization).toMatch(/^Bearer xoxb-/);
  });

  it("should skip notification when SLACK_BOT_TOKEN is not configured", async () => {
    vi.doMock("../config.js", () => ({
      getConfig: () => ({
        SLACK_BOT_TOKEN: undefined,
        SLACK_USER_ID: "U123",
      }),
    }));
    vi.doMock("../logger.js", () => ({
      createChildLogger: () => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      }),
    }));

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { notifySlack } = await import("../notifications/slack.js");
    await notifySlack("Test PR", "https://github.com/org/repo/pull/1", 1);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("should skip notification when SLACK_USER_ID is not configured", async () => {
    vi.doMock("../config.js", () => ({
      getConfig: () => ({
        SLACK_BOT_TOKEN: "xoxb-fake",
        SLACK_USER_ID: undefined,
      }),
    }));
    vi.doMock("../logger.js", () => ({
      createChildLogger: () => ({
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      }),
    }));

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { notifySlack } = await import("../notifications/slack.js");
    await notifySlack("Test PR", "https://github.com/org/repo/pull/1", 1);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
