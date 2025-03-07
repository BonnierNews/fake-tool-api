import { randomUUID } from "crypto";
import { expect } from "chai";
import fetch from "node-fetch";

import * as fakeToolApi from "../index.js";

const baseUrl = "https://fake-tool-api-test";
describe("Fake tool api", () => {

  const events = [];
  beforeEach(() => {
    fakeToolApi.init(baseUrl, (msg) => {
      events.push(JSON.parse(msg.data));
    });
    fakeToolApi.addType({ name: "article" }, true);
    events.length = 0;
  });
  const id = randomUUID();

  describe("working-copy", () => {
    it("should support PUT:ing working copy", async () => {
      await putJson(`${baseUrl}/article/${id}/working-copy`, { name: "Hello" });
      const getRes = await fetch(`${baseUrl}/article/${id}/working-copy`);
      const article = await getRes.json();
      expect(article.name).to.eql("Hello");
      expect(fakeToolApi.peekWorkingCopy("article", id).name).to.eql("Hello");

    });

    it("should support adding working copies via api", async () => {
      fakeToolApi.addWorkingCopy("article", id, { name: "Hi" });
      const getRes = await fetch(`${baseUrl}/article/${id}/working-copy`);
      const article = await getRes.json();
      expect(article.name).to.eql("Hi");
      expect(fakeToolApi.peekWorkingCopy("article", id).name).to.eql("Hi");
    });

    it("should support deleting working copies", async () => {
      fakeToolApi.addWorkingCopy("article", id, { name: "Hi" });
      await fetch(`${baseUrl}/article/${id}/working-copy`, { method: "DELETE" });
      expect(fakeToolApi.peekWorkingCopy("article", id)).to.not.exist;
    });

    it("should support auto-removal of working copies if query is set", async () => {
      fakeToolApi.addContent("article", id, { headline: "TODO" });
      fakeToolApi.addWorkingCopy("article", id, { headline: "Working title..." });
      await putJson(`${baseUrl}/article/${id}?deleteWorkingCopy=true`, { headline: "I think I got it now!" });
      expect(fakeToolApi.peekWorkingCopy("article", id)).to.not.exist;
    });

    it("should not auto-remove working copy if query is set but request is not OK", async () => {
      fakeToolApi.intercept((method, url) => {
        if (method === "GET" && url.includes(`/article/${id}`)) {
          return [ 404 ];
        }
      });

      fakeToolApi.addWorkingCopy("article", id, { headline: "Title" });
      await fetch(`${baseUrl}/article/${id}?deleteWorkingCopy=true`);
      expect(fakeToolApi.peekWorkingCopy("article", id).headline).to.eql("Title");
    });
  });

  describe("#deleteContent", () => {

    it("should return 200 when delete:ing content", async () => {
      fakeToolApi.addContent("article", id, { headline: "Hej" });
      await fetch(`${baseUrl}/article/${id}`);
      const res = await fetch(`${baseUrl}/article/${id}`, { method: "DELETE" });
      expect(res.status).to.eql(200);
      expect(events).to.have.length(2);
      expect(events[1]).to.have.property("event", "unpublished");
      expect(events[1]).to.have.property("id", id);
      expect(events[1]).to.have.property("type", "article");
    });

    it("should return 404 when delete:ing non-existing content", async () => {
      const res = await fetch(`${baseUrl}/article/${randomUUID()}`, { method: "DELETE" });
      expect(res.status).to.eql(404);
    });
    it("should return 404 when delete:ing previously deteted content", async () => {
      fakeToolApi.addContent("article", id, { headline: "Hej" });
      let res = await fetch(`${baseUrl}/article/${id}`);
      expect(res.status).to.eql(200);
      res = await fetch(`${baseUrl}/article/${id}`, { method: "DELETE" });
      expect(res.status).to.eql(200);
      res = await fetch(`${baseUrl}/article/${id}`, { method: "DELETE" });
      expect(res.status).to.eql(404);
    });
  });

  describe("#addContent", () => {

    it("should make content get:ble after adding it", async () => {
      fakeToolApi.addContent("article", id, { headline: "Hej" });
      const res = await fetch(`${baseUrl}/article/${id}`);
      const data = await res.json();
      expect(data.headline).to.eql("Hej");
    });

    it("should notify registered pubsub-listener for each change", () => {
      fakeToolApi.addContent("article", id, { headline: "Event?" });
      expect(events).to.have.length(1);
      expect(events[0]).to.have.property("event", "published");
      expect(events[0]).to.have.property("id", id);
      expect(events[0]).to.have.property("type", "article");
    });

    it("should not notify registered pubsub-listener if skipEvents param is supplied", () => {
      fakeToolApi.addContent("article", id, { headline: "Event?" }, true);
      expect(events).to.eql([]);
    });

  });

  describe("#addType", () => {
    beforeEach(() => {
      fakeToolApi.clearBaseTypes();
    });

    it("should let user know if a type has already been defined", () => {
      fakeToolApi.addType({ name: "test" });
      expect(() => fakeToolApi.addType({ name: "test" })).to.throw("Type test is already defined");
    });

    it("should allow type redefinitions if explicitly set", async () => {
      fakeToolApi.addType({ name: "test" });
      fakeToolApi.addType({
        name: "test",
        properties: { attributes: { type: "object", properties: { cool: { type: "string" } } } },
      }, true);

      const res = await fetch(`${baseUrl}/types`);
      const types = await res.json();
      expect(types[0].properties.attributes.properties).to.have.property("cool");
    });
  });

  describe("PUT /content", () => {

    it("should reject non-uuid ids", async () => {
      const res = await putJson(`${baseUrl}/article/clearly-not-an-uuid`, {});
      expect(res.status).to.eql(400);
    });

    it("should allow microsoft reserved guids", async () => {
      // Fourth part of guid starts with a c
      let res = await putJson(`${baseUrl}/article/c8ada615-4e8b-26fd-cb97-c038bfa6e8e6`, {});
      expect(res.status).to.eql(200);

      // Fourth part of guid starts with a d
      res = await putJson(`${baseUrl}/article/c8ada615-4e8b-26fd-db97-c038bfa6e8e6`, {});
      expect(res.status).to.eql(200);
    });

    it("should reject content of unknown type", async () => {
      const res = await putJson(`${baseUrl}/craZy-stuff/${id}`, {});
      expect(res.status).to.eql(404);
    });

    it("should make content get:ble after adding it", async () => {
      await putJson(`${baseUrl}/article/${id}`, { headline: "Blah" });
      const res = await fetch(`${baseUrl}/article/${id}`);
      const data = await res.json();
      expect(data.headline).to.eql("Blah");
    });

    it("should increase version number for each updatde", async () => {
      await putJson(`${baseUrl}/article/${id}`, { headline: "Blah" });
      expect(fakeToolApi.peekContent("article", id).sequenceNumber).to.eql(1);
      await putJson(`${baseUrl}/article/${id}?ifSequenceNumber=1`, { headline: "Blah 2" });
      expect(fakeToolApi.peekContent("article", id).sequenceNumber).to.eql(2);
      await putJson(`${baseUrl}/article/${id}?ifSequenceNumber=2`, { headline: "Blah 3" });
      expect(fakeToolApi.peekContent("article", id).sequenceNumber).to.eql(3);
    });

    it("should notify registered pubsub-listener for each change", async () => {
      await putJson(`${baseUrl}/article/${id}`, { headline: "Event?" });
      expect(events).to.have.length(1);
      expect(events[0]).to.have.property("event", "published");
      expect(events[0]).to.have.property("id", id);
      expect(events[0]).to.have.property("type", "article");
    });
  });

  describe("GET /content", () => {
    it("should return working-copy-exists header when entity has working copy", async () => {
      await putJson(`${baseUrl}/article/${id}`, { headline: "Blah" });
      await putJson(`${baseUrl}/article/${id}/working-copy`, { headline: "Habla" });
      const res = await fetch(`${baseUrl}/article/${id}`);
      const workingCopyExists = res.headers.get("working-copy-exists");
      expect(workingCopyExists).to.eql("true");
    });
  });

  describe("GET /referenced-by", () => {
    it("should return a shallow list of referensing content", async () => {
      fakeToolApi.addContent("article", id, { headline: "Hej" });
      const res = await fetch(`${baseUrl}/article/${id}/referenced-by`, {});
      const references = await res.json();
      expect(references.length).to.eql(2);
    });
  });

  describe("user settings", () => {
    it("should support CRUD routes", async () => {
      const userId = randomUUID();
      const settings = { a: "b", b: "a" };
      const crudUrl = `${baseUrl}/user-setting/${userId}/my-type/my-key`;

      let response = await putJson(crudUrl, settings);
      let data = await response.json();
      expect(data).to.eql(settings);

      response = await fetch(crudUrl);
      data = await response.json();
      expect(data).to.eql(settings);

      const updatedSetting = { a: "c" };
      response = await putJson(crudUrl, updatedSetting);
      data = await response.json();
      expect(data).to.eql(updatedSetting);

      response = await fetch(crudUrl);
      data = await response.json();
      expect(data).to.eql(updatedSetting);

      response = await fetch(crudUrl, { method: "DELETE" });
      expect(response.status).to.eql(200);

      response = await fetch(crudUrl);
      expect(response.status).to.eql(404);

      response = await fetch(crudUrl, { method: "DELETE" });
      expect(response.status).to.eql(404);

      // Never seen type
      const unseenUserId = randomUUID();
      let url = `${baseUrl}/user-setting/${unseenUserId}/unseen-type/my-key`;
      response = await fetch(url);
      expect(response.status).to.eql(404);
      response = await fetch(url, { method: "DELETE" });
      expect(response.status).to.eql(404);

      // Never seen user
      url = `${baseUrl}/user-setting/${unseenUserId}/unseen-type/my-key`;
      response = await fetch(url);
      expect(response.status).to.eql(404);
      response = await fetch(url, { method: "DELETE" });
      expect(response.status).to.eql(404);
    });

    it("is supported to add user settings using the module", async () => {
      const userId = randomUUID();
      const settings = { a: "b", b: "a" };
      fakeToolApi.addUserSetting(userId, "my-type", "my-key", settings);

      const crudUrl = `${baseUrl}/user-setting/${userId}/my-type/my-key`;
      const response = await fetch(crudUrl);
      const data = await response.json();
      expect(data).to.eql(settings);
    });
  });

  describe("POST /search", () => {
    it("should return unfiltered results when posting empty object", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "banana" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "orange" } });

      const response = await postJson(`${baseUrl}/search`, {});
      const responseBody = await response.json();

      expect(response.status).to.eql(200);
      expect(responseBody).to.have.property("hits");
      const content1Hit = responseBody.hits.find((hit) => hit.id === content1Id);
      expect(content1Hit).to.exist;
      expect(content1Hit).to.have.property("type", "article");
      expect(content1Hit).to.have.property("title", "banana");
      expect(content1Hit).to.not.have.property("content");
      expect(responseBody).to.have.property("total", 2);
    });

    it("should filter by text query in attributes.name field", async () => {
      const matchingId = randomUUID();
      fakeToolApi.addContent("article", matchingId, { attributes: { name: "banana " } });
      const notMatchingId = randomUUID();
      fakeToolApi.addContent("article", notMatchingId, { attributes: { name: "orange " } });

      const response = await postJson(`${baseUrl}/search`, { q: "banana" });
      const responseBody = await response.json();
      expect(responseBody.hits).to.have.length(1);
      expect(responseBody.hits[0].id).to.eql(matchingId);
    });

    it("should include content when returnContent: true", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "banana" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "orange" } });

      const response = await postJson(`${baseUrl}/search`, { returnContent: true });
      const responseBody = await response.json();

      expect(response.status).to.eql(200);
      expect(responseBody).to.have.property("hits");
      const content1Hit = responseBody.hits.find((hit) => hit.id === content1Id);
      expect(content1Hit).to.exist;
      expect(content1Hit).to.have.property("content");
      expect(content1Hit.content).to.have.property("attributes");
      expect(content1Hit.content.attributes).to.have.property("name", "banana");
    });

    it("should support filtering by type", async () => {
      const channelId = randomUUID();
      fakeToolApi.addContent("channel", channelId, { attributes: { name: "name" } });
      const publishingGroupId = randomUUID();
      fakeToolApi.addContent("publishing-group", publishingGroupId, { attributes: { name: "name" } });
      const articleId = randomUUID();
      fakeToolApi.addContent("article", articleId, { attributes: { name: "name" } });

      const response = await postJson(`${baseUrl}/search`, { types: [ "publishing-group", "channel" ] });
      const responseBody = await response.json();

      expect(response.status).to.eql(200);
      expect(responseBody).to.have.property("hits");
      expect(responseBody.total).to.equal(2);
      const ids = responseBody.hits.map((hit) => hit.id);
      expect(ids).to.include(publishingGroupId);
      expect(ids).to.include(channelId);
    });

    it("should support sorting by given text attribute in ascending order", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "banana" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "apple" } });

      const response = await postJson(`${baseUrl}/search`, { sort: [ { by: "title", order: "asc" } ] });
      const responseBody = await response.json();

      expect(response.status).to.eql(200);
      expect(responseBody).to.have.property("hits");
      expect(responseBody.hits).to.have.length(2);

      expect(responseBody.hits[0].title).to.equal("apple");
      expect(responseBody.hits[1].title).to.equal("banana");
    });

    it("should support sorting by given text attribute in descending order", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "apple" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "banana" } });

      const response = await postJson(`${baseUrl}/search`, { sort: [ { by: "title", order: "desc" } ] });
      const responseBody = await response.json();

      expect(response.status).to.eql(200);
      expect(responseBody).to.have.property("hits");
      expect(responseBody.hits).to.have.length(2);

      expect(responseBody.hits[0].title).to.equal("banana");
      expect(responseBody.hits[1].title).to.equal("apple");
    });

    it("should return number of hits based on size parameter", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "apple" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "banana" } });
      const response = await postJson(`${baseUrl}/search`, { size: 1 });
      expect(response.status).to.eql(200);
      const responseBody = await response.json();
      expect(responseBody.hits).to.have.length(1);
      expect(responseBody.hits[0].title).to.equal("apple");
    });

    it("should support paging through results", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "apple" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "banana" } });
      const response = await postJson(`${baseUrl}/search`, { from: 1, size: 1 });
      expect(response.status).to.eql(200);
      const responseBody = await response.json();
      expect(responseBody.hits).to.have.length(1);
      expect(responseBody.hits[0].title).to.equal("banana");
    });

    it("should find articles where any term starts with the search query using prefix behavior", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "apple" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "bananas in pyjamas" } });
      const content3Id = randomUUID();
      fakeToolApi.addContent("article", content3Id, { attributes: { name: "pyjamas" } });

      const response = await postJson(`${baseUrl}/search`, { q: "pyjam banan", behavior: "prefix" });
      expect(response.status).to.eql(200);
      const responseBody = await response.json();
      expect(responseBody.hits).to.have.length(1);
      expect(responseBody.hits[0].title).to.equal("bananas in pyjamas");
    });

    it("should return no articles when no term starts with the search query using prefix behavior", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "apple" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "bananas in pyjamas" } });

      const response = await postJson(`${baseUrl}/search`, { q: "pear", behavior: "prefix" });
      expect(response.status).to.eql(200);
      const responseBody = await response.json();
      expect(responseBody.hits).to.have.length(0);
    });
  });

  describe("GET /:type/autocomplete", () => {
    it("should require a search query", async () => {
      const response = await fetch(`${baseUrl}/article/autocomplete`);
      expect(response.status).to.eql(400);
    });

    it("should return matching content", async () => {
      const channels = [ randomUUID(), randomUUID() ];
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "banana melon kiwi lemon", channels } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "orange" } });

      const response = await fetch(`${baseUrl}/article/autocomplete?keyword=${encodeURIComponent("melon ki")}`);
      const responseBody = await response.json();

      expect(response.status).to.eql(200);
      expect(responseBody).to.have.property("result");
      expect(responseBody.result).to.have.length(1);
      expect(responseBody.result[0]).to.deep.equal({
        id: content1Id,
        name: "banana melon kiwi lemon",
        channels,
      });
    });

    it("should filter matching content given channel", async () => {
      const channels = [ randomUUID(), randomUUID() ];
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "banana", channels } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "banana", channel: channels[0] } });

      const response1 = await fetch(`${baseUrl}/article/autocomplete?keyword=ban&channel=${channels[0]}`);
      const responseBody1 = await response1.json();

      expect(response1.status).to.eql(200);
      expect(responseBody1).to.have.property("result");
      expect(responseBody1.result).to.have.length(2);

      const response2 = await fetch(`${baseUrl}/article/autocomplete?keyword=ban&channel=${channels[1]}`);
      const responseBody2 = await response2.json();

      expect(response2.status).to.eql(200);
      expect(responseBody2).to.have.property("result");
      expect(responseBody2.result).to.have.length(1);
      expect(responseBody2.result[0].id).to.equal(content1Id);
    });
  });

  describe("POST /slug", () => {
    it("should cause a conflict if two entites in the same channel requests the same slug", async () => {
      const channelId = randomUUID();
      const firstContentId = randomUUID();
      let response = await postJson(`${baseUrl}/slug`, {
        channels: [ channelId ],
        desiredPath: "/test-path",
        value: firstContentId,
        valueType: "content",
      });
      expect(response.status).to.eql(200);

      const secondContentId = randomUUID();
      response = await postJson(`${baseUrl}/slug`, {
        channels: [ channelId ],
        desiredPath: "/test-path",
        value: secondContentId,
        valueType: "content",
      });
      expect(response.status).to.eql(409);
    });

    it("should not cause a conflict if an entity requests the same slug multiple times", async () => {
      const channelId = randomUUID();
      const contentID = randomUUID();
      let response = await postJson(`${baseUrl}/slug`, {
        channels: [ channelId ],
        desiredPath: "/test-path",
        value: contentID,
        valueType: "content",
      });
      expect(response.status).to.eql(200);

      response = await postJson(`${baseUrl}/slug`, {
        channels: [ channelId ],
        desiredPath: "/test-path",
        value: contentID,
        valueType: "content",
      });
      expect(response.status).to.eql(200);
    });
  });
});

async function postJson(url, obj) {
  return await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(obj),
  });
}

async function putJson(url, obj) {
  return await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(obj),
  });
}
