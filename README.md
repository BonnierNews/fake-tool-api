# Fake tool api
Mock version of Bonnier News tool api, for use in automated tests.
See 'test/index.spec.js' for example usage

## nock

The fake registers its routes with your project's `nock`. The supported versions are listed as a peer dependency in package.json. The fake only answers requests made with Node's native `fetch` with nock 14 or later.

The fake's routes are optional, so `nock.isDone()` and `nock.pendingMocks()` don't report them. `nock.cleanAll()` removes them, so call `init()` or `initNock()` again after it, for example in a `beforeEach`.
