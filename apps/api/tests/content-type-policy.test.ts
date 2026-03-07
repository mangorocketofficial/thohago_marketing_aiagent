import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildContentTypesForChannels,
  getAllowedContentTypesForChannel,
  resolveChannelContentType
} from "../src/orchestrator/content-type-policy";

describe("content type policy", () => {
  it("returns channel-specific publish types", () => {
    assert.deepEqual(getAllowedContentTypesForChannel("naver_blog"), ["text"]);
    assert.deepEqual(getAllowedContentTypesForChannel("threads"), ["text"]);
    assert.deepEqual(getAllowedContentTypesForChannel("instagram"), ["image"]);
    assert.deepEqual(getAllowedContentTypesForChannel("facebook"), ["text", "image"]);
    assert.deepEqual(getAllowedContentTypesForChannel("youtube"), ["video"]);
  });

  it("resolves fallback content type by channel", () => {
    assert.equal(resolveChannelContentType({ channel: "instagram" }), "image");
    assert.equal(resolveChannelContentType({ channel: "youtube" }), "video");
    assert.equal(resolveChannelContentType({ channel: "threads" }), "text");
  });

  it("alternates facebook text/image when type is not specified", () => {
    assert.equal(resolveChannelContentType({ channel: "facebook", sequenceIndex: 0 }), "text");
    assert.equal(resolveChannelContentType({ channel: "facebook", sequenceIndex: 1 }), "image");
    assert.equal(resolveChannelContentType({ channel: "facebook", sequenceIndex: 2 }), "text");
  });

  it("collects campaign-level content type set from channels", () => {
    const result = buildContentTypesForChannels(["naver_blog", "threads", "instagram", "facebook", "youtube"]);
    assert.deepEqual(result, ["text", "image", "video"]);
  });
});
