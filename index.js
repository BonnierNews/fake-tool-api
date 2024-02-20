import nock from "nock";

let contentByType = {};
let paths = [];
const listRegex = /^\/([\w-]+)\/all(.*)$/;
const singleContentRegex = /^\/([\w-]+)\/([\w-]+)$/;
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const getPathsRegex = /^\/slug\/byValue\/([\w-]+)$/;
const mgetPathsRegex = /^\/slugs\/byValues$/;

let interceptor = null;

let pubSubListener;
export function init(toolApiBaseUrl, listener) {
  pubSubListener = listener;
  clear();
  const mock = nock(toolApiBaseUrl);
  mock
    .get("/types")
    .reply(interceptable(types))
    .get(listRegex)
    .reply(interceptable(list))
    .persist()
    .get(singleContentRegex)
    .reply(interceptable(get))
    .persist()
    .get(getPathsRegex)
    .reply(interceptable(getPaths))
    .post(mgetPathsRegex)
    .reply(interceptable(mgetPaths))
    .persist()
    .post("/slug") // todo collisionresolver
    .query(true)
    .reply(interceptable(postPath))
    .persist()
    .put(singleContentRegex)
    .reply(interceptable(put))
    .persist()
    .delete(singleContentRegex)
    .reply(interceptable(deleteContent))
    .persist();
}

export function intercept(interceptFn) {
  interceptor = interceptFn;
}
export async function addContent(type, id, content, skipEvents) {
  addType(type);

  const existingContent = contentByType[type][id];
  const sequenceNumber = existingContent?.sequenceNumber ? existingContent?.sequenceNumber + 1 : 1;
  content.updated = content.updated || new Date().toISOString();
  contentByType[type][id] = { sequenceNumber, content };
  if (!skipEvents && pubSubListener) await sendEvent(type, id, "published");
}

export function addPath(path) {
  if (path.channels) {
    throw new Error("slug.channels is deprecated, use slug.channel instead");
  }
  if (!path.publishTime) {
    path.publishTime = new Date();
  }
  paths.push(path);
}

export function removePath(path) {
  paths = paths.filter((p) => !(p.channel === path.channelId && p.value === path.value && p.path === path.path));
}

export async function removeContent(type, id) {
  delete contentByType[type][id];
  await sendEvent(type, id, "unpublished");
}

export function addType(type) {
  if (!contentByType[type]) {
    contentByType[type] = {};
  }
}

export function peekContent(type, id) {
  return contentByType[type]?.[id];
}

export function peekPaths() {
  return paths;
}

export function clear() {
  contentByType = {};
  paths.length = 0;
  interceptor = null;
}

function interceptable(fn) {
  return function () {
    const interceptorFn = interceptor || (() => {});
    const intercepted = interceptorFn(this.method, ...arguments);
    if (intercepted) return intercepted;
    return fn.apply(this, arguments);
  };

}

function types() {
  const responseBody = Object.keys(contentByType).map((typeName) => {
    return {
      name: typeName,
      title: typeName,
      pluralTitle: typeName,
    };
  });
  return [ 200, responseBody ];
}

function list(url) {
  const [ , type, query ] = url.match(listRegex) || [];
  const queryParams = new URLSearchParams(query);
  const parentId = queryParams.get("parent");
  const ofType = contentByType[type];
  if (!ofType) {
    return [ 404 ];
  }

  let items, nextCursor;
  if (parentId) {
    items = Object.keys(ofType)
      .map((id) => {
        if (ofType[id].attributes.parentId === parentId) {
          return {
            id,
            sequenceNumber: ofType[id].sequenceNumber,
            content: ofType[id].content,
          };
        }
      })
      .filter(Boolean);
  } else {
    items = Object.keys(ofType).map((id) => {
      return {
        id,
        sequenceNumber: ofType[id].sequenceNumber,
        content: ofType[id].content,
      };
    });
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

  const size = queryParams.get("size");
  if (size) {
    const intSize = parseInt(size);
    let startIndex = 0;
    const incomingCursor = queryParams.get("cursor");
    if (incomingCursor) {
      const cursorItem = items.find((item) => item.id === incomingCursor);
      startIndex = items.indexOf(cursorItem) + 1;
    }
    items = items.slice(startIndex, startIndex + intSize);
    if (items.length === intSize) {
      const lastItem = items.slice(-1)[0];
      nextCursor = lastItem.id;
    }
  }

  const responseBody = { items, nextCursor };
  return [ 200, responseBody ];
}

function get(url) {

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
  return [ 200, content.content, { "sequence-number": content.sequenceNumber } ];
}

function getPaths(url) {
  const matches = url.match(getPathsRegex);
  const [ , id ] = matches || [];
  if (!id.match(uuidRegex)) {
    return [ 400 ];
  }

  const matchingPaths = paths.filter((path) => path.value === id);
  return [ 200, { slugs: matchingPaths } ];
}

function mgetPaths(url, body) {
  if (!body.values) {
    return [ 400 ];
  }
  const response = {};
  body.values.forEach((value) => {
    response[value] = [];
  });

  paths.forEach((path) => {
    if (body.values.indexOf(path.value) !== -1) {
      response[path.value].push(path);
    }
  });

  return [ 200, response ];
}

function postPath(url, body) {
  const { channel, value, valueType, publishTime } = body;
  paths.push({
    path: body.desiredPath,
    channel,
    value,
    valueType,
    publishTime,
  });
  return [ 200, "OK" ];
}

function put(url, body) {

  const matches = url.match(singleContentRegex);
  const [ , type, id ] = matches || [];
  if (!id.match(uuidRegex)) {
    return [ 400 ];
  }
  const ofType = contentByType[type];
  if (!ofType) {
    return [ 404 ];
  }

  addContent(type, id, body);

  return [ 200, body ];
}

function deleteContent(url) {
  const matches = url.match(singleContentRegex);
  const [ , type, id ] = matches || [];
  if (!id.match(uuidRegex)) {
    return [ 400 ];
  }
  const ofType = contentByType[type];
  if (!ofType) {
    return [ 404 ];
  }

  removeContent(type, id);

  return [ 200 ];
}

async function sendEvent(type, id, event) {
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
