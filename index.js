import nock from "nock";
import { randomUUID } from "crypto";
import { pathToRegexp, match } from "path-to-regexp";

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89abcd][0-9a-f]{3}-[0-9a-f]{12}$/i;

const routes = {
  userSettings: buildRoute("/user-setting/:userId/:type/:key", {
    get: getUserSetting,
    put: putUserSetting,
    delete: deleteUserSetting,
  }),
  list: buildRoute("{/:type}/all", { get: list }),
  slugs: buildRoute("/slugs", { get: slugsList }),
  slugsByValues: buildRoute("/slugs/byValues", { post: filterSlugsByValues }),
  getSlug: buildRoute("/slug/:id", { get: getSlug, delete: deleteSlug }),
  getSlugByValue: buildRoute("/slug/byValue/:id", { get: filterSlugsByValue }),
  postSlug: buildRoute("/slug", { post: requestSlug }),
  autocomplete: buildRoute("/:type/autocomplete", { get: autocomplete }),
  workingCopy: buildRoute("/:type/:id/working-copy", {
    get: getWorkingCopy,
    put: putWorkingCopy,
    delete: deleteWorkingCopy,
  }),
  versions: buildRoute("/:type/:id/versions", { get: getVersions }),
  getVersion: buildRoute("/:type/:id/versions/:version", { get: getVersion }),
  referencedBy: buildRoute("/:type/:id/referenced-by", { get: getReferencedBy }),
  search: buildRoute("/search", { post: search }),
  types: buildRoute("/types", { get: getTypes }),
  singleContent: buildRoute("/:type/:id", {
    get: getContent,
    put: putContent,
    delete: deleteContent,
  }),
};

let types, contentByType, workingCopiesByType = {}, userSettings, slugs = [], versionsMeta = {}, versions = {}, referencedBy = {}, baseUrl;
let interceptor = () => { };

function buildRoute(route, handlers) {
  return {
    route,
    regexp: pathToRegexp(route).regexp,
    match: match(route),
    handlers,
  };
}

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
  const scope = nock(url);

  Object.keys(routes).forEach((route) => {
    const routeConfig = routes[route];

    Object.keys(routeConfig.handlers).forEach((verb) => {
      const handler = routeConfig.handlers[verb];

      scope[verb](routeConfig.regexp)
        .query(true)
        .reply(interceptable(handler, routeConfig))
        .persist();
    });
  });
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
  workingCopiesByType = {};
  contentByType = {};
}

export function addWorkingCopy(type, id, content) {
  if (!workingCopiesByType[type]) {
    workingCopiesByType[type] = {};
  }
  workingCopiesByType[type][id] = { created: new Date().toISOString(), updated: new Date().toISOString(), ...content };
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

export async function addSlug(slug) {
  //console.log("awasdad")
  if (!slug.publishTime) {
    slug.publishTime = new Date();
  }
  slugs.push(slug);

  const { valueType: type, value: id } = slug;
  const valueContent = contentByType[type][id];

  if (shouldSendPublishingEventMessage(types[type], valueContent)) {
    //console.log("🐐", "adsadsd");
    await sendEvent(type, id, "published");
  }
  //console.log(JSON.stringify(slug, null, 2));
}

export function removeSlug(slug) {
  slugs = slugs.filter((p) => !(
    p.channel === slug.channel
    && p.value === slug.value
    && p.path === slug.path));
}
export function addType(type, allowRedefine = false) {
  if (!type.properties) {
    type.properties = {};
  }
  if (types[type.name] && !allowRedefine) {
    throw new Error(`Type ${type.name} is already defined`);
  }

  types[type.name] = mapType(type);
  contentByType[type.name] = {};
  workingCopiesByType[type.name] = {};
}

export function peekContent(type, id) {
  return contentByType[type]?.[id];
}

export function peekWorkingCopy(type, id) {
  return workingCopiesByType[type]?.[id];
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

function interceptable(routeInterceptor, route) {
  return function (url, body) {
    const intercepted = interceptor(this.method, url, body);
    if (intercepted) return intercepted;

    const href = new URL(url, baseUrl);
    const req = {
      method: this.method,
      params: route.match(href.pathname).params,
      searchParams: href.searchParams,
      url,
      body,
    };

    const result = routeInterceptor(req);

    if (result && result[0] <= 299) {
      const type = req.params.type;
      const id = req.params.id;

      if (type && id && req.searchParams.get("deleteWorkingCopy") === "true") {
        delete workingCopiesByType[type]?.[id];
      }
    }

    return result;
  };
}

function initBasetypes() {
  clearBaseTypes();
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
    canHaveSlugs: true,
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
      type: "enum",
      options: [ {
        value: "DRAFT",
        label: "DRAFT",
      },
      {
        value: "FINISHED",
        label: "FINISHED",
      },
      {
        value: "PUBLISHED",
        label: "PUBLISHED",
      },
      {
        value: "CANCELED",
        label: "CANCELED",
      } ],
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

/**
 * Default Route handlers
 */

function putUserSetting(req) {
  const { userId, type, key } = req.params;
  const body = req.body;
  addUserSetting(userId, type, key, body);
  return [ 200, body ];
}

function getUserSetting(req) {
  const { userId, type, key } = req.params;
  const found = userSettings[userId]?.[type]?.[key];
  if (!found) {
    return [ 404 ];
  }

  return [ 200, found ];
}

function deleteUserSetting(req) {
  const { userId, type, key } = req.params;
  if (!userSettings[userId]?.[type]?.[key]) {
    return [ 404 ];
  }
  delete userSettings[userId][type][key];
  return [ 200 ];
}

function list(req) {
  const type = req.params.type;
  const parent = req.searchParams.get("parent");
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

  const keyword = req.searchParams.get("keyword");
  if (keyword) {
    items = items.filter((item) => item.content.attributes.name.toLowerCase().includes(keyword.toLocaleLowerCase()));
  }

  const channel = req.searchParams.get("channel");
  if (channel) {
    const typeDefinition = types[type];
    if (typeDefinition.channelSpecific) {
      items = items.filter((item) => item.content.attributes.channel === channel);
    } else {
      items = items.filter((item) => item.content.attributes.channels.indexOf(channel) !== -1);
    }
  }

  const publishingGroup = req.searchParams.get("publishingGroup");
  if (publishingGroup) {
    items = items.filter((item) => item.content.publishingGroup === publishingGroup);
  }

  const onlyPublished = req.searchParams.get("onlyPublished");
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

  const activeState = req.searchParams.get("activeState");
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

  const excludeFromPublishingEvents = req.searchParams.get("excludeFromPublishingEvents");
  if (excludeFromPublishingEvents === "true") {
    const excludeTypes = Object.values(types).filter((t) => t.excludeFromPublishingEvents).map((td) => td.name);
    items = items.filter((item) => {
      return excludeTypes.indexOf(item.type) === -1;
    });
  }
  const filterTypes = req.searchParams.getAll("type");
  if (filterTypes.length > 0) {
    items = items.filter((item) => filterTypes.includes(item.type));
  }

  const orgLength = items.length;

  let responseItems = items;
  const from = req.searchParams.get("cursor");
  if (from) {
    items = items.slice(parseInt(from));
  }
  const size = req.searchParams.get("size");
  if (size) {
    responseItems = items.slice(0, parseInt(size));
  }
  let nextCursor, nextUrl;
  if (responseItems.length < items.length) {
    nextCursor = orgLength - (items.length - responseItems.length);
    const nextUrlObj = new URL(req.url, baseUrl);
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

async function requestSlug(req) {
  //console.log("sdfsfsdf", req)
  //console.log(JSON.stringify(types, null, 2));

  const slug = structuredClone(req.body || {});

  slug.channel = slug.channel || slug.channels[0];
  slug.path = slug.desiredPath;
  delete slug.desiredPath;
  slug.id = randomUUID();

  if (slug.publishTime === "") {
    return [ 400 ];
  }

  if (!slug.publishTime) {
    slug.publishTime = new Date().toISOString();
  }

  const matchingSlug = slugs.find((s) => s.channel === slug.channel && s.path === slug.path);

  if (matchingSlug && (matchingSlug.value !== slug.value || matchingSlug.valueType !== slug.valueType)) {
    return [ 409 ];
  }

  if (!matchingSlug) {
    slugs.push(slug);
  }

  const { valueType: type, value: id } = slug;
  const valueContent = contentByType[type][id];

  if (shouldSendPublishingEventMessage(types[type], valueContent)) {
    //console.log("🐐", "adsadsd");
    await sendEvent(type, id, "published");
  }

  const responseObject = {
    ids: [ slug.id ],
    path: slug.path,
  };
  return [ 200, responseObject ];
}

function shouldSendPublishingEventMessage(typeDefinition, valueContent) {
  if (!valueContent) return false;
  if (typeDefinition.hasPublishedState && valueContent.publishedState !== "PUBLISHED") return false;
  if (valueContent.attributes.firstPublishTime && new Date(valueContent.attributes.firstPublishTime) > new Date()) return false;

  return true;
}

function filterSlugsByValue(req) {
  const id = req.params.id;
  const filtered = slugs.filter((s) => s.value === id);
  filtered.sort((a, b) => {
    return b.publishTime.localeCompare(a.publishTime);
  });
  return [ 200, { slugs: filtered } ];
}

function filterSlugsByValues(req) {
  if (!req.body?.values) {
    return [ 400 ];
  }
  const response = {};
  req.body.values.forEach((value) => {
    response[value] = [];
  });
  slugs.forEach((slug) => {
    if (req.body.values.indexOf(slug.value) !== -1) {
      response[slug.value].push(slug);
    }
  });
  return [ 200, response ];
}

function getSlug(req) {
  const id = req.params.id;
  const slug = slugs.find((s) => s.id === id);
  if (!slug) {
    return [ 404 ];
  }
  return [ 200, slug ];
}

function deleteSlug(req) {
  const id = req.params.id;
  const slug = slugs.find((s) => s.id === id);
  if (!slug) {
    return [ 404 ];
  }
  slugs.splice(slugs.indexOf(slug), 1);
  return [ 200 ];
}

function slugsList(req) {
  let items = slugs;
  const channel = req.searchParams.get("channel");
  if (channel) {
    items = items.filter((item) => item.channel === channel);
  }
  const path = req.searchParams.get("path");
  if (path) {
    items = items.filter((item) => item.path === path);
  }
  const valueType = req.searchParams.get("valueType");
  if (valueType) {
    items = items.filter((item) => item.valueType === valueType);
  }
  const value = req.searchParams.get("value");
  if (value) {
    items = items.filter((item) => item.value === value);
  }
  const responseBody = { items/* , next*/ };
  return [ 200, responseBody ];
}

function autocomplete(req) {
  if (!req.searchParams.get("keyword") || req.searchParams.get("keyword").length < 2) return [ 400 ];

  const type = req.params.type;
  const q = req.searchParams.get("keyword").trim().toLowerCase();
  const publishingGroup = req.searchParams.get("publishingGroup");
  const channel = req.searchParams.get("channel");
  const ofType = contentByType[type];
  const result = Object.keys(ofType)
    .map((id) => {
      return { id, content: ofType[id] };
    })
    .filter(({ content }) => ` ${content.attributes.name.toLowerCase()}`.includes(` ${q}`))
    .filter(({ content }) => !publishingGroup || content.publishingGroup === publishingGroup)
    .filter(({ content }) => !channel || content.attributes.channel === channel || content.attributes.channels?.includes(channel))
    .map(({ id, content }) => {
      return {
        id,
        name: content.attributes.name,
        description: content.attributes.description,
        channels: types[type].channelSpecific ? [ content.attributes.channel ] : content.attributes.channels,
      };
    });

  const responseBody = { result };
  return [ 200, responseBody ];
}

function getWorkingCopy(req) {
  const { type, id } = req.params;
  const workingCopy = workingCopiesByType[type]?.[id];
  return workingCopy ? [ 200, workingCopy ] : [ 404 ];
}

function getContent(req) {
  const { type, id } = req.params;
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
  const headers = { "sequence-number": ofType[id].sequenceNumber };
  if (workingCopiesByType[type]?.[id]) {
    headers["working-copy-exists"] = true;
  }
  return [ 200, content, headers ];
}

function putWorkingCopy(req) {
  const { type, id } = req.params;

  const ofType = workingCopiesByType[type];
  if (!ofType) {
    return [ 404 ];
  }
  ofType[id] = structuredClone(req.body);

  return [ 200, ofType[id] ];
}

function putContent(req) {
  const { type, id } = req.params;
  if (!id.match(uuidRegex)) {
    return [ 400 ];
  }
  const ofType = contentByType[type];
  if (!ofType) {
    return [ 404 ];
  }
  let parsedSequenceNumber = 0;
  const sequenceNumber = req.searchParams.get("ifSequenceNumber");
  if (sequenceNumber !== null) {
    parsedSequenceNumber = parseInt(sequenceNumber);
    if (ofType[id] && (ofType[id].sequenceNumber !== parsedSequenceNumber)) {
      return [ 409 ];
    }
  }
  const storedObject = structuredClone(req.body);
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

function deleteWorkingCopy(req) {
  const { type, id } = req.params;
  delete workingCopiesByType[type]?.[id];
  return [ 200 ];
}

async function deleteContent(req) {
  const { type, id } = req.params;
  if (!id.match(uuidRegex)) {
    return [ 400 ];
  }
  const ofType = contentByType[type];
  if (!ofType || !ofType[id]) {
    return [ 404 ];
  }
  delete contentByType[type][id];
  await sendEvent(type, id, "unpublished");
  return [ 200 ];
}

function search(req) {
  let matchingContent = Object.keys(contentByType).flatMap((typeName) => {
    if (req.body.types && !req.body.types.includes(typeName)) {
      return [];
    }
    const ofType = contentByType[typeName];
    const ids = Object.keys(ofType);

    return ids.map((id) => {
      const content = ofType[id];
      const hit = {
        type: typeName,
        id,
        title: content.attributes?.name,
      };

      if (req.body.returnContent) {
        hit.content = content;
      }

      return hit;
    });
  });

  if (req.body.q) {
    const fields = [ "title", "text" ];
    const queryTerms = req.body.q.trim().toLowerCase().split(/\s+/);

    matchingContent = matchingContent.filter((potentialHit) => {
      const contentTokens = fields.flatMap((field) => {
        return (potentialHit[field] || "")
          .trim()
          .toLowerCase()
          .split(/\s+/);
      });
      if (req.body.behavior === "prefix") {
        return queryTerms.every((term) =>
          contentTokens.some((contentToken) => contentToken.startsWith(term))
        );
      } else {
        return queryTerms.some((term) =>
          contentTokens.includes(term)
        );
      }
    });
  }

  if (req.body.sort && Array.isArray(req.body.sort) && req.body.sort.length > 0) {
    matchingContent.sort((aObj, bObj) => {
      const a = aObj[req.body.sort[0].by];
      const b = bObj[req.body.sort[0].by];
      if (typeof a === "string" && typeof b === "string") {
        if (req.body.sort[0].order === "asc") {
          return a.localeCompare(b);
        }
        return b.localeCompare(a);
      }
    });
  }

  const from = req.body.from || 0;
  let size = req.body.size || matchingContent.length;

  if (req.body.from && req.body.size) {
    size = req.body.from + req.body.size;
  }

  return [ 200, { hits: matchingContent.slice(from, size), total: matchingContent.length } ];
}

function getTypes() {
  return [ 200, Object.values(types) ];
}

function getVersions(req) {
  const { type, id } = req.params;
  return [ 200, { items: versionsMeta?.[type]?.[id] } ];
}

function getVersion(req) {
  const { type, id, version } = req.params;
  return [ 200, versions[type][id][version] ];
}

function getReferencedBy(req) {
  const { type, id } = req.params;
  return [ 200, referencedBy[type]?.[id] || [] ];
}
