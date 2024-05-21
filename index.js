import nock from "nock";
import { randomUUID } from "crypto";

let types, contentByType, userSettings, slugs = [], versionsMeta = {}, versions = {}, referencedBy = {}, baseUrl;
const userSettingRegex = /^\/user-setting\/([\w-]+)\/([\w-]+)\/([\w-]+)/;
const listRegex = /^\/*([\w-]+)?\/all(.*)$/;
const slugsRegex = /^\/slugs(\?.*)?/;
const getSlugRegex = /^\/slug\/([\w-]+)/;
const getSlugByValueRegex = /^\/slug\/byValue\/([\w-]+)/;
const getSlugsByValuesRegex = /^\/slugs\/byValues$/;
const postSlugRegex = /^\/slug(\?.*)?/;
const autocompleteRegex = /^\/([\w-]+)\/autocomplete(.*)$/;
const singleContentRegex = /^\/([\w-]+)\/([\w-]+)$/;
const putContentRegex = /^\/([\w-]+)\/([\w-]+)\??([^&]*)$/;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const versionsRegex = /^\/([\w-]+)\/([\w-]+)\/versions$/;
const referencedByRegex = /^\/([\w-]+)\/([\w-]+)\/referenced-by$/;
const versionRegex = /^\/([\w-]+)\/([\w-]+)\/versions\/\d+$/;
let interceptor = () => { };
export function init(url, pubSubListenerArg) {
  initNock(url);
  initPubsub(pubSubListenerArg);
  resetContent();
}

let pubSubListener = null;
export function initPubsub(listener) {
  pubSubListener = listener;
}

// Sets nock listeners and basic types (channel, publishingGroup, tag and article)
export function initNock(url) {

  baseUrl = url;
  const mock = nock(url);
  mock
    .put(userSettingRegex)
    .reply(interceptable(putUserSetting))
    .get(userSettingRegex)
    .reply(interceptable(getUserSetting))
    .delete(userSettingRegex)
    .reply(interceptable(deleteUserSetting))
    .get(listRegex)
    .reply(interceptable(list))
    .get(slugsRegex)
    .reply(interceptable(slugsList))
    .get(getSlugByValueRegex)
    .reply(interceptable(filterSlugsByValue))
    .post(getSlugsByValuesRegex)
    .reply(interceptable(filterSlugsByValues))
    .get(getSlugRegex)
    .reply(interceptable(getSlug))
    .delete(getSlugRegex)
    .reply(interceptable(deleteSlug))
    .post(postSlugRegex)
    .reply(interceptable(requestSlug))
    .get(autocompleteRegex)
    .reply(interceptable(autocomplete))
    .get(versionRegex)
    .reply(interceptable(getVersion))
    .get(versionsRegex)
    .reply(interceptable(getVersions))
    .get(referencedByRegex)
    .reply(interceptable(getReferencedBy))
    .get(singleContentRegex)
    .reply(interceptable(getContent))
    .put(putContentRegex)
    .reply(interceptable(putContent))
    .delete(singleContentRegex)
    .reply(interceptable(deleteContent))
    .post("/search")
    .reply(interceptable(search))
    .get("/types")
    .reply(interceptable(getTypes))
    .persist();
}

export function intercept(interceptFn) {
  interceptor = interceptFn || (() => { });
}

// resets content an initialize basic types ()
export function resetContent() {
  initBasetypes();
  slugs = [];
  interceptor = () => { };
  versionsMeta = {};
  versions = {};
  referencedBy = {};
  userSettings = {};
}

// Removes all base types (needed for a few very generic tests)
export function clearBaseTypes() {
  types = {};
}

export async function addContent(type, id, content, skipEvents) {
  if (!contentByType[type]) {
    contentByType[type] = {};
  }
  contentByType[type][id] = { created: new Date().toISOString(), updated: new Date().toISOString(), ...content, sequenceNumber: 1 };
  if (types[type]?.versioned) {
    storeVersion(type, id, { ...contentByType[type][id], updated: new Date().toISOString() });
  }
  addReferencingContent(type, id, [ { id: "123", type: "article" }, { id: "456", type: "article" } ]);
  if (!skipEvents) await sendEvent(type, id, "published");
}

export async function removeContent(type, id) {
  delete contentByType[type][id];
  await sendEvent(type, id, "unpublished");
}

export function addSlug(slug) {
  if (!slug.publishTime) {
    slug.publishTime = new Date();
  }
  slugs.push(slug);
}

export function removeSlug(slug) {
  slugs = slugs.filter((p) => !(
    p.channel === slug.channel
    && p.value === slug.value
    && p.path === slug.path));
}
export function addType(type) {
  if (!type.properties) {
    type.properties = {};
  }
  if (!types[type.name]) {
    types[type.name] = mapType(type);

  }
  if (!contentByType[type.name]) {
    contentByType[type.name] = {};
  }
}

export function peekContent(type, id) {
  return contentByType[type]?.[id];
}

export function peekSlugs() {
  return slugs;
}

async function sendEvent(type, id, event) {
  if (!pubSubListener) return;
  const message = {
    id,
    data: Buffer.from(JSON.stringify({
      event,
      type,
      id,
      updated: new Date(),
    })),
    attributes: {},
  };
  await pubSubListener(message);
}

export function addUserSetting(userId, type, key, value) {
  userSettings[userId] = userSettings[userId] || {};
  userSettings[userId][type] = userSettings[userId][type] || {};
  userSettings[userId][type][key] = value;
}

function putUserSetting(url, body) {
  const [ , userId, type, key ] = url.match(userSettingRegex) || [];
  addUserSetting(userId, type, key, body);
  return [ 200, body ];
}

function getUserSetting(url) {
  const [ , userId, type, key ] = url.match(userSettingRegex) || [];
  const found = userSettings[userId]?.[type]?.[key];
  if (!found) {
    return [ 404 ];
  }

  return [ 200, found ];
}

function deleteUserSetting(url) {
  const [ , userId, type, key ] = url.match(userSettingRegex) || [];
  if (!userSettings[userId]?.[type]?.[key]) {
    return [ 404 ];
  }
  delete userSettings[userId][type][key];
  return [ 200 ];
}

function list(url) {
  const [ , type, query ] = url.match(listRegex) || [];
  const queryParams = new URLSearchParams(query);
  const parent = queryParams.get("parent");
  let ofType;
  if (type) {
    ofType = contentByType[type];
    if (!ofType) {
      return [ 404 ];
    }
  } else {
    ofType = Object.keys(contentByType).reduce((acc, t) => {
      return { ...acc, ...contentByType[t] };
    }, {});
  }
  const typeByContentId = {};
  for (const [ t, contentById ] of Object.entries(contentByType)) {
    for (const contentId of Object.keys(contentById)) {
      typeByContentId[contentId] = t;
    }
  }

  let items;
  if (parent) {
    if (parent === "none") {
      items = Object.keys(ofType).map((id) => {
        return {
          id,
          type: typeByContentId[id],
          content: ofType[id],
        };
      }).filter(({ content }) => !content.attributes.parent);
    } else {
      items = Object.keys(ofType).map((id) => {
        if (ofType[id].attributes.parent === parent) {
          return { id, content: ofType[id], type: ofType[id].type };
        }
      }).filter(Boolean);
    }
    items.forEach((item) => {
      item.hasChildren = Object.values(ofType).some((potentialChild) => potentialChild.attributes?.parent === item.id);
    });
  } else {
    items = Object.keys(ofType).map((id) => {
      return {
        id,
        type: typeByContentId[id],
        content: ofType[id],
      };
    });
  }

  const keyword = queryParams.get("keyword");
  if (keyword) {
    items = items.filter((item) => item.content.attributes.name.toLowerCase().includes(keyword.toLocaleLowerCase()));
  }

  const channel = queryParams.get("channel");
  if (channel) {
    const typeDefinition = types[type];
    if (typeDefinition.channelSpecific) {
      items = items.filter((item) => item.content.attributes.channel === channel);
    } else {
      items = items.filter((item) => item.content.attributes.channels.indexOf(channel) !== -1);
    }
  }

  const publishingGroup = queryParams.get("publishingGroup");
  if (publishingGroup) {
    items = items.filter((item) => item.content.publishingGroup === publishingGroup);
  }

  const onlyPublished = queryParams.get("onlyPublished");
  if (onlyPublished === "true") {
    items = items.filter((item) => {
      if (item.content.attributes.firstPublishTime && new Date(item.content.attributes.firstPublishTime) > new Date()) {
        return false;
      }
      if (item.content.publishedState && item.content.publishedState !== "PUBLISHED") {
        return false;
      }
      return true;
    });
  }

  const activeState = queryParams.get("activeState");
  if (activeState) {
    items = items.filter((item) => {
      if (activeState === "active") {
        return item.content.active;
      }
      if (activeState === "inactive") {
        return !item.content.active;
      }
    });
  }
  const excludeFromPublishingEvents = queryParams.get("excludeFromPublishingEvents");
  if (excludeFromPublishingEvents === "true") {
    const excludeTypes = Object.values(types).filter((t) => t.excludeFromPublishingEvents).map((td) => td.name);
    items = items.filter((item) => {
      return excludeTypes.indexOf(item.type) === -1;
    });
  }
  const filterTypes = queryParams.getAll("type");
  if (filterTypes.length > 0) {
    items = items.filter((item) => filterTypes.includes(item.type));
  }

  const orgLength = items.length;

  let responseItems = items;
  const from = queryParams.get("cursor");
  if (from) {
    items = items.slice(parseInt(from));
  }
  const size = queryParams.get("size");
  if (size) {
    responseItems = items.slice(0, parseInt(size));
  }
  let nextCursor, nextUrl;
  if (responseItems.length < items.length) {
    const reqUrl = new URL(this.req.options.href);
    let newCursor = parseInt(size);
    if (from) {
      newCursor += parseInt(from);
    }
    if (keyword) {
      reqUrl.searchParams.set("keyword", keyword);
    }

    reqUrl.searchParams.set("cursor", newCursor);
    nextCursor = orgLength - (items.length - responseItems.length);
    const nextUrlObj = new URL(`${baseUrl}${url}`);
    nextUrlObj.searchParams.set("cursor", nextCursor);
    nextUrl = nextUrlObj.toString();

  }
  responseItems = JSON.parse(JSON.stringify(responseItems));
  responseItems.forEach((item) => {
    item.sequenceNumber = item.content.sequenceNumber;
    delete item.content.sequenceNumber;
  });
  const responseBody = { items: responseItems, nextCursor, next: nextUrl };
  return [ 200, responseBody ];
}

function requestSlug(url, body) {
  body.channel = body.channel || body.channels[0];
  body.path = body.desiredPath;
  delete body.desiredPath;
  body.id = randomUUID();

  if (body.publishTime === "") {
    return [ 400 ];
  }

  if (!body.publishTime) {
    body.publishTime = new Date().toISOString();
  }

  const conflictingSlug = slugs.some((s) => s.channel === body.channel && s.path === body.path);
  if (conflictingSlug) {
    return [ 409 ];
  }

  slugs.push(body);
  const responseObject = {
    ids: [ body.id ],
    path: body.path,
  };
  return [ 200, responseObject ];
}

function filterSlugsByValue(url) {
  const [ , id ] = url.match(getSlugByValueRegex) || [];
  const filtered = slugs.filter((s) => s.value === id);
  return [ 200, { slugs: filtered } ];
}

function filterSlugsByValues(url, body) {
  if (!body.values) {
    return [ 400 ];
  }
  const response = {};
  body.values.forEach((value) => {
    response[value] = [];
  });
  slugs.forEach((slug) => {
    if (body.values.indexOf(slug.value) !== -1) {
      response[slug.value].push(slug);
    }
  });
  return [ 200, response ];
}

function getSlug(url) {
  const [ , id ] = url.match(getSlugRegex) || [];
  const slug = slugs.find((s) => s.id === id);
  if (!slug) {
    return [ 404 ];
  }
  return [ 200, slug ];
}

function deleteSlug(url) {
  const [ , id ] = url.match(getSlugRegex) || [];
  const slug = slugs.find((s) => s.id === id);
  if (!slug) {
    return [ 404 ];
  }
  slugs.splice(slugs.indexOf(slug), 1);
  return [ 200 ];
}

function slugsList(url) {
  const [ , query ] = url.match(slugsRegex) || [];
  const queryParams = new URLSearchParams(query);
  let items = slugs;
  const channel = queryParams.get("channel");
  if (channel) {
    items = items.filter((item) => item.channel === channel);
  }
  const path = queryParams.get("path");
  if (path) {
    items = items.filter((item) => item.path === path);
  }
  const valueType = queryParams.get("valueType");
  if (valueType) {
    items = items.filter((item) => item.valueType === valueType);
  }
  const value = queryParams.get("value");
  if (value) {
    items = items.filter((item) => item.value === value);
  }
  const responseBody = { items/* , next*/ };
  return [ 200, responseBody ];
}

function autocomplete(url) {
  const [ , type, query ] = url.match(autocompleteRegex) || [];
  const searchParams = new URLSearchParams(query);
  const q = searchParams.get("keyword");
  const publishingGroup = searchParams.get("publishingGroup");
  const channel = searchParams.get("channel");
  const ofType = contentByType[type];
  const result = Object.keys(ofType)
    .map((id) => {
      return { id, content: ofType[id] };
    })
    .filter(({ content }) => content.attributes.name.startsWith(q))
    .filter(({ content }) => !publishingGroup || content.publishingGroup === publishingGroup)
    .filter(({ content }) => !channel || content.attributes.channel === channel)
    .map(({ id, content }) => {
      return {
        id,
        name: content.attributes.name,
        description: content.attributes.description,
        channel: types[type].channelSpecific ? content.attributes.channel : undefined,
      };
    });

  const responseBody = { result };
  return [ 200, responseBody ];
}

function getContent(url) {
  const matches = url.match(singleContentRegex);
  const [ , type, id ] = matches || [];
  if (!id.match(uuidRegex)) {
    return [ 400 ];
  }
  const ofType = contentByType[type];
  if (!ofType) {
    return [ 404 ];
  }
  const content = ofType[id];
  if (!content) {
    return [ 404 ];
  }
  return [ 200, content, { "sequence-number": ofType[id].sequenceNumber } ];
}

function interceptable(fn) {
  return function () {
    const intercepted = interceptor(this.method, ...arguments);
    if (intercepted) return intercepted;
    return fn.apply(this, arguments);
  };

}

function putContent(url, body) {
  const matches = url.match(putContentRegex);
  const [ , type, id, query ] = matches || [];
  const qs = new URLSearchParams(query);
  if (!id.match(uuidRegex)) {
    return [ 400 ];
  }
  const ofType = contentByType[type];
  if (!ofType) {
    return [ 404 ];
  }
  let parsedSequenceNumber = 0;
  const sequenceNumber = qs.get("ifSequenceNumber");
  if (sequenceNumber !== null) {
    parsedSequenceNumber = parseInt(sequenceNumber);
    if (ofType[id] && (ofType[id].sequenceNumber !== parsedSequenceNumber)) {
      return [ 409 ];
    }
  }
  const storedObject = JSON.parse(JSON.stringify(body));
  const now = new Date().toISOString();
  storedObject.updated = new Date().toISOString();
  if (!ofType[id]) {
    storedObject.created = now;
  }
  ofType[id] = { ...storedObject, sequenceNumber: parsedSequenceNumber + 1 };
  if (types[type].versioned) {
    storeVersion(type, id, ofType[id]);
  }
  sendEvent(type, id, "published");
  return [ 200, storedObject, { "sequence-number": parsedSequenceNumber + 1 } ];
}

async function deleteContent(url) {
  const matches = url.match(singleContentRegex);
  const [ , type, id ] = matches || [];
  if (!id.match(uuidRegex)) {
    return [ 400 ];
  }
  const ofType = contentByType[type];
  if (!ofType) {
    return [ 404 ];
  }
  delete contentByType[type][id];
  await sendEvent(type, id, "unpublished");
  return [ 200 ];
}

function search(url, body) {
  let matchingContent = Object.keys(contentByType).flatMap((typeName) => {
    if (body.types && !body.types.includes(typeName)) {
      return [];
    }
    const ofType = contentByType[typeName];
    const ids = Object.keys(ofType);

    // const mapped =
    return ids.map((id) => {
      const content = ofType[id];
      const hit = {
        type: typeName,
        id,
        title: content.attributes?.name,
      };

      if (body.returnContent) {
        hit.content = content;
      }

      return hit;
    });
  });

  if (body.q) {
    matchingContent = matchingContent.filter((potentialHit) => {
      const titleTokens = (potentialHit.title || "").split(" ").map((t) => t.toLowerCase());
      return titleTokens.includes(body.q.toLocaleLowerCase());
    });
  }

  if (body.sort && Array.isArray(body.sort) && body.sort.length > 0) {
    matchingContent.sort((aObj, bObj) => {
      const a = aObj[body.sort[0].by];
      const b = bObj[body.sort[0].by];
      if (typeof a === "string" && typeof b === "string") {
        if (body.sort[0].order === "asc") {
          return a.localeCompare(b);
        }
        return b.localeCompare(a);
      }
    });
  }

  const from = body.from || 0;
  let size = body.size || matchingContent.length;

  if (body.from && body.size) {
    size = body.from + body.size;
  }

  return [ 200, { hits: matchingContent.slice(from, size), total: matchingContent.length } ];
}

function getTypes() {
  return [ 200, Object.values(types) ];
}

function initBasetypes() {
  contentByType = { channel: {}, "publishing-group": {} };
  types = {};
  addType({
    name: "channel",
    properties: { attributes: { type: "object", properties: { name: { type: "string" } } } },
  });
  addType({
    name: "publishing-group",
    properties: { attributes: { type: "object", properties: { name: { type: "string" } } } },
  });
  addType({
    name: "article",
    properties: { attributes: { type: "object", properties: { name: { type: "string" }, headline: { type: "string" } } } },
  });
}

function mapType(type) {
  type.title = type.title || type.name;
  type.pluralTitle = type.pluralTitle || type.title;
  addStandardProperties(type);
  addTypeSpecificProperties(type);
  type.ui = type.ui || {};
  type.ui.displayProperty = type.ui.displayProperty || "attributes.name";
  return type;
}

function addStandardProperties(type) {
  type.properties.editedBy = {
    type: "object",
    properties: {
      name: { type: "string", required: true },
      email: { type: "string", format: "email" },
      oneLoginId: { type: "string" },
    },
  };

  type.properties.active = {
    type: "boolean",
    description: "Archive state",
    required: true,
  };
  type.properties.created = {
    type: "datetime",
    readOnly: true,
  };

  type.properties.updated = {
    type: "datetime",
    readOnly: true,
  };

  applyDefaults(type.properties);
}

function addTypeSpecificProperties(type) {
  if (type.hasPublishedState) {
    type.properties.publishedState = {
      description: "published state",
      type: "string",
      enum: [ "DRAFT", "FINISHED", "PUBLISHED", "CANCELED" ],
      required: true,
    };
  }

  if (type.channelSpecific) {
    type.publishingGroupSpecific = true;
    type.properties.attributes.properties.channel = {
      type: "reference",
      referenceType: "channel",
      title: "Kanal",
      required: type.name !== "section" ? true : false, // Temp hack for backwards compatibility. Can be removed when we are master for sections.
    };
  }

  if (type.publishingGroupSpecific) {
    type.properties.publishingGroup = {
      type: "reference",
      referenceType: "publishing-group",
      ui: { hidden: true },
    };
  }

  if (type.hierarchical) {
    type.properties.attributes.properties.parent = {
      type: "reference",
      referenceType: type.name,
      title: "Förälder",
    };
  }
}

function applyDefaults(properties) {
  Object.keys(properties).forEach((propertyName) => {
    const property = properties[propertyName];

    if (property.type === "object") {
      applyDefaults(property.properties);
    }
    if (property.type === "enum") {
      property.options.forEach((option) => {
        if (!option.label) {
          option.label = option.value;
        }
      });
    }

    if (property.type !== "object") {
      property.title = property.title || propertyName;
    }
  });
}

function getVersions(url) {
  const [ , type, id ] = url.split("/");
  return [ 200, { items: versionsMeta?.[type]?.[id] } ];
}

function storeVersion(type, id, content) {
  if (!versionsMeta[type]) {
    versionsMeta[type] = {};
    versions[type] = {};
  }
  if (!versionsMeta[type][id]) {
    versionsMeta[type][id] = [];
    versions[type][id] = {};
  }
  versionsMeta[type][id].unshift({
    sequenceNumber: content.sequenceNumber,
    created: content.updated,
    path: `/${type}/${id}/versions/${content.sequenceNumber}`,
    publishedBy: "jan.banan@example.com",
  });
  versions[type][id][content.sequenceNumber] = content;
}

function addReferencingContent(type, id, referencingItems) {
  if (!referencedBy[type]) {
    referencedBy[type] = {};
  }
  referencedBy[type][id] = referencingItems;
}

function getReferencedBy(url) {
  const [ , type, id ] = url.split("/");
  return [ 200, referencedBy[type]?.[id] || [] ];
}

function getVersion(url) {
  const [ , type, id, , version ] = url.split("/");
  return [ 200, versions[type][id][version] ];
}
