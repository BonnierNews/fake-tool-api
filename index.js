import nock from "nock";
import { randomUUID } from "crypto";

let types, contentByType, slugs = [], versionsMeta = {}, versions = {}, baseUrl;
const listRegex = /^\/([\w-]+)\/all(\?.*)?/;
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
const versionRegex = /^\/([\w-]+)\/([\w-]+)\/versions\/\d+$/;
let interceptor = () => {};

export function intercept(interceptFn) {
  interceptor = interceptFn || (() => {});
}

let pubSubListener = null;
export function init(url, listener) {
  // console.log("- - - INIT");

  baseUrl = url;
  pubSubListener = listener;
  reset();
  const mock = nock(url);
  mock
    .get(listRegex)
    .reply(interceptable(list))
    .persist()
    .get(slugsRegex)
    .reply(interceptable(slugsList))
    .persist()
    .get(getSlugByValueRegex)
    .reply(interceptable(filterSlugsByValue))
    .persist()
    .post(getSlugsByValuesRegex)
    .reply(interceptable(filterSlugsByValues))
    .persist()
    .get(getSlugRegex)
    .reply(interceptable(getSlug))
    .persist()
    .delete(getSlugRegex)
    .reply(interceptable(deleteSlug))
    .persist()
    .post(postSlugRegex)
    .reply(interceptable(requestSlug))
    .persist()
    .get(autocompleteRegex)
    .reply(interceptable(autocomplete))
    .persist()
    .get(versionRegex)
    .reply(interceptable(getVersion))
    .get(versionsRegex)
    .reply(interceptable(getVersions))
    .get(singleContentRegex)
    .reply(interceptable(getContent))
    .persist()
    .put(putContentRegex)
    .reply(interceptable(putContent))
    .persist()
    .delete(singleContentRegex)
    .reply(interceptable(deleteContent))
    .persist()
    .get("/types")
    .reply(interceptable(getTypes))
    .persist();

  // mock.on("request", (req, interceptor, body) => console.log("- - - REQUEST", req.options.href));
  // mock.on("replied", (req, interceptor) => console.log("- - - REPLIED", req.options.href, req.res.statusCode));
}

export function reset() {
  // console.log("- - - RESET");

  initBasetypes();
  slugs = [];
  interceptor = () => {};
  versionsMeta = {};
  versions = {};
}

export function clearAllTypes() {
  types = {};
}

export async function addContent(type, id, content, skipEvents) {

  if (!contentByType[type]) {
    contentByType[type] = {};
  }
  contentByType[type][id] = { updated: new Date().toISOString(), ...content, sequenceNumber: 1 };
  if (types[type]?.versioned) {
    storeVersion(type, id, { ...contentByType[type][id], updated: new Date().toISOString() });
  }
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
  // console.log("- - - ADD", type.name);

  if (!type.properties) {
    type.properties = {};
  }
  if (!types[type.name]) {
    types[type.name] = mapType(type);

  }
  if (!contentByType[type.name]) {
    contentByType[type.name] = {};
  }
  // console.log("- - - REALLY ADD", Object.values(types).map((t) => t.name));
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
    })),
    attributes: {},
  };
  await pubSubListener(message);
}
//
// function getArticle(url) {
//
//   const [ , id ] = url.match(getArticleRegex) || [];
//   let targetTypeById;
//
//   Object.keys(contentByType).forEach((type) => {
//     targetTypeById = contentByType[type][id];
//   });
//   return [ 200, { ...targetTypeById } ];
// }

function list(url) {
  // const listRegex = /^\/([\w-]+)\/all(\?.*)?/;
  const [ , type, query ] = url.match(listRegex) || [];
  const queryParams = new URLSearchParams(query);
  const parent = queryParams.get("parent");
  const ofType = contentByType[type];
  if (!ofType) {
    return [ 404 ];
  }

  let items;
  if (parent) {
    if (parent === "none") {
      items = Object.keys(ofType).map((id) => {
        return {
          id,
          content: ofType[id],
        };
      }).filter(({ content }) => !content.attributes.parent);
    } else {
      items = Object.keys(ofType).map((id) => {
        if (ofType[id].attributes.parent === parent) {
          return { id, content: ofType[id] };
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
      return true;
    });
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

function getTypes() {
  // console.log("- - - TYPES", Object.values(types).map((t) => t.name));

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
  // todo maybe not here
  addType({
    name: "article",
    properties: { attributes: { type: "object", properties: { headline: { type: "string" } } } },
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
      // required: true,
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

function getVersion(url) {
  const [ , type, id, , version ] = url.split("/");
  return [ 200, versions[type][id][version] ];
}
