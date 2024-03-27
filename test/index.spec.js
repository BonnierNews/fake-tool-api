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
