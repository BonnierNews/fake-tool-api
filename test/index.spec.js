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
    fakeToolApi.addType({ name: "article" });
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

    it("should find articles where any term starts with the search query using prefixMatchAllTerms", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "apple" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "bananas in pyjamas" } });

      const response = await postJson(`${baseUrl}/search`, { q: 'pyjam', prefixMatchAllTerms: true });
      expect(response.status).to.eql(200);
      const responseBody = await response.json();
      expect(responseBody.hits).to.have.length(1);
      expect(responseBody.hits[0].title).to.equal("bananas in pyjamas");
    });

    it("should return no articles when no term starts with the search query using prefixMatchAllTerms", async () => {
      const content1Id = randomUUID();
      fakeToolApi.addContent("article", content1Id, { attributes: { name: "apple" } });
      const content2Id = randomUUID();
      fakeToolApi.addContent("article", content2Id, { attributes: { name: "bananas in pyjamas" } });

      const response = await postJson(`${baseUrl}/search`, { q: 'pear', prefixMatchAllTerms: true });
      expect(response.status).to.eql(200);
      const responseBody = await response.json();
      expect(responseBody.hits).to.have.length(0);
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
