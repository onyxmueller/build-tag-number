'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runAction } = require('./helpers/run_action');

test('no existing tags (404): starts at build number 1 and creates new ref', async () => {
    const r = await runAction({ refsStatus: 404 });
    assert.equal(r.exit_code, null);
    assert.equal(r.build_number, 1);
    assert.equal(r.env_build_number, 1);
    const posts = r.http_calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1);
    assert.ok(posts[0].body.includes('refs/tags/build-number-1'));
    const deletes = r.http_calls.filter((c) => c.method === 'DELETE');
    assert.equal(deletes.length, 0);
});

test('existing tags with default delete behavior: increments and deletes old refs', async () => {
    const r = await runAction({ tags: 3 });
    assert.equal(r.exit_code, null);
    assert.equal(r.build_number, 4);
    const posts = r.http_calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1);
    assert.ok(posts[0].body.includes('refs/tags/build-number-4'));
    const deletes = r.http_calls.filter((c) => c.method === 'DELETE');
    assert.equal(deletes.length, 3);
});

test('add annotated tags with default delete behavior: increments and deletes old refs', async () => {
    const r = await runAction({ tags: 3, inputs: { annotated_tag: true }  });
    assert.equal(r.exit_code, null);
    assert.equal(r.build_number, 4);
    const posts = r.http_calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 2);
    assert.ok(posts[0].path.includes('/git/tags'));
    assert.ok(posts[0].body.includes('"message":"Build number 4"'));
    assert.ok(posts[1].path.includes('/git/refs'));
    assert.ok(posts[1].body.includes('refs/tags/build-number-4'));
    const deletes = r.http_calls.filter((c) => c.method === 'DELETE');
    assert.equal(deletes.length, 3);
});

test('delete_previous_tag=false: increments without deleting old refs', async () => {
    const r = await runAction({ tags: 3, inputs: { delete_previous_tag: false } });
    assert.equal(r.exit_code, null);
    assert.equal(r.build_number, 4);
    const deletes = r.http_calls.filter((c) => c.method === 'DELETE');
    assert.equal(deletes.length, 0);
});

test('prefix input is applied to the created ref', async () => {
    const r = await runAction({ refsStatus: 404, inputs: { prefix: 'v' } });
    assert.equal(r.exit_code, null);
    const get = r.http_calls.find((c) => c.method === 'GET');
    assert.ok(get.path.includes('/refs/tags/v-build-number-'));
    const post = r.http_calls.find((c) => c.method === 'POST');
    assert.ok(post.body.includes('refs/tags/v-build-number-1'));
});

test('missing INPUT_TOKEN fails fast with exit 1', async () => {
    const r = await runAction({ env: { INPUT_TOKEN: null } });
    assert.equal(r.exit_code, 1);
    assert.equal(r.http_calls.length, 0);
});

test('missing GITHUB_REPOSITORY fails fast with exit 1', async () => {
    const r = await runAction({ env: { GITHUB_REPOSITORY: null } });
    assert.equal(r.exit_code, 1);
    assert.equal(r.http_calls.length, 0);
});

test('missing GITHUB_SHA fails fast with exit 1', async () => {
    const r = await runAction({ env: { GITHUB_SHA: null } });
    assert.equal(r.exit_code, 1);
    assert.equal(r.http_calls.length, 0);
});

test('cached BUILD_NUMBER file short-circuits API calls', async () => {
    const r = await runAction({ existingBuildNumberFile: '42' });
    assert.equal(r.exit_code, null);
    assert.equal(r.build_number, 42);
    assert.equal(r.env_build_number, 42);
    assert.equal(r.http_calls.length, 0);
});

test('too many tags with delete_previous_tag=true fails with exit 1', async () => {
    const r = await runAction({ tags: 6 });
    assert.equal(r.exit_code, 1);
    const posts = r.http_calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 0, 'should bail before creating a new ref');
});

// When the user has explicitly set delete_previous_tag=false, build-number
// refs are expected to accumulate beyond the safety threshold of 5. The
// action must not treat that as an error. Fix: PR #21.
test('too many tags with delete_previous_tag=false does NOT fail', async () => {
    const r = await runAction({ tags: 6, inputs: { delete_previous_tag: false } });
    assert.equal(r.exit_code, null, 'action should not fail when user opted out of deletion');
    assert.equal(r.build_number, 7);
    const deletes = r.http_calls.filter((c) => c.method === 'DELETE');
    assert.equal(deletes.length, 0, 'no refs should be deleted');
});
