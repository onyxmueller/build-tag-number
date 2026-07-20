'use strict';

// Runs inside fork(). Reads JSON config from argv[2], installs https + fs
// stubs, then requires the action's main.js. Emits a JSON summary line to
// stdout before exiting so the parent can assert on behavior.

const Module = require('module');
const realFs = require('fs');

const opts = JSON.parse(process.argv[2]);
const {
    actionMain,
    tags = 0,
    refsStatus = 200,
    createStatus = 201,
    deleteStatus = 204,
    inputs = {},
    env = {},
    existingBuildNumberFile = null,
} = opts;

let exitCode = null;
const realExit = process.exit;
process.exit = (code) => {
    if (exitCode === null) exitCode = code;
    throw new Error(`__STUB_EXIT_${code}__`);
};
process.on('uncaughtException', (e) => {
    if (!String(e && e.message).startsWith('__STUB_EXIT_')) {
        console.error('UNEXPECTED_ERROR:', (e && e.stack) || e);
        if (exitCode === null) exitCode = 2;
    }
});

const httpCalls = [];

function buildRefs(prefix, n) {
    const refs = [];
    for (let i = 1; i <= n; i++) {
        refs.push({
            ref: `refs/tags/${prefix}build-number-${i}`,
            object: { sha: 'deadbeef' },
        });
    }
    return refs;
}

const stubHttps = {
    request(options, callback) {
        const method = options.method;
        const reqPath = options.path;
        const call = { method, path: reqPath, hostname: options.hostname, port: options.port };
        httpCalls.push(call);
        process.nextTick(() => {
            let status;
            let body;
            if (method === 'GET') {
                status = refsStatus;
                if (refsStatus === 200) {
                    const prefix = inputs.prefix ? `${inputs.prefix}-` : '';
                    body = Buffer.from(JSON.stringify(buildRefs(prefix, tags)));
                } else {
                    body = Buffer.from(JSON.stringify({ message: 'Not Found' }));
                }
            } else if (method === 'POST') {
                status = createStatus;
                body = Buffer.from(JSON.stringify({ ok: true }));
            } else if (method === 'DELETE') {
                status = deleteStatus;
                body = Buffer.alloc(0);
            } else {
                status = 500;
                body = Buffer.alloc(0);
            }
            const res = {
                statusCode: status,
                headers: {},
                on(event, fn) {
                    if (event === 'data' && body.length > 0) fn(body);
                    if (event === 'end') fn();
                },
            };
            callback(res);
        });
        return { on() {}, write(b) { call.body = b.toString(); }, end() {} };
    },
};

const writes = {};
const stubFs = Object.create(realFs);
stubFs.existsSync = (p) => p === 'BUILD_NUMBER/BUILD_NUMBER' && existingBuildNumberFile !== null;
stubFs.readFileSync = (p, ...rest) => {
    if (p === 'BUILD_NUMBER/BUILD_NUMBER' && existingBuildNumberFile !== null) {
        return Buffer.from(String(existingBuildNumberFile));
    }
    return realFs.readFileSync(p, ...rest);
};
stubFs.writeFileSync = (p, data) => { writes[p] = data.toString(); };

const origRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'https') return stubHttps;
    if (id === 'fs') return stubFs;
    return origRequire.apply(this, arguments);
};

const baseEnv = {
    INPUT_TOKEN: 'fake-token',
    GITHUB_REPOSITORY: 'test-owner/test-repo',
    GITHUB_SHA: 'cafebabe',
    GITHUB_OUTPUT: '/tmp/gh_output_stub',
    GITHUB_ENV: '/tmp/gh_env_stub',
};
// GitHub Actions runners pre-populate GITHUB_OUTPUT, GITHUB_ENV,
// GITHUB_REPOSITORY, and GITHUB_SHA — force-overwrite so the action writes
// to our stub paths instead of the runner's real ones.
for (const k of Object.keys(baseEnv)) {
    process.env[k] = baseEnv[k];
}
// GitHub-hosted runners also pre-populate GITHUB_API_URL — remove it so tests
// exercise the api.github.com fallback unless a test sets it explicitly.
delete process.env.GITHUB_API_URL;
for (const [k, v] of Object.entries(env)) {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
}
if (inputs.token !== undefined) process.env.INPUT_TOKEN = inputs.token;
if (inputs.prefix !== undefined) process.env.INPUT_PREFIX = inputs.prefix;
if (inputs.delete_previous_tag !== undefined) {
    process.env.INPUT_DELETE_PREVIOUS_TAG = String(inputs.delete_previous_tag);
}
if (inputs.annotated_tag !== undefined) {
    process.env.INPUT_ANNOTATED_TAG = String(inputs.annotated_tag);
}

try {
    require(actionMain);
} catch (e) {
    if (!String(e && e.message).startsWith('__STUB_EXIT_')) {
        console.error('UNEXPECTED_ERROR:', (e && e.stack) || e);
        if (exitCode === null) exitCode = 2;
    }
}

function parseKV(s, key) {
    if (!s) return null;
    const m = s.match(new RegExp(`${key}=(\\S+)`));
    return m ? parseInt(m[1], 10) : null;
}

setTimeout(() => {
    const summary = {
        exit_code: exitCode,
        http_calls: httpCalls,
        writes,
        build_number: parseKV(writes['/tmp/gh_output_stub'], 'build_number'),
        env_build_number: parseKV(writes['/tmp/gh_env_stub'], 'BUILD_NUMBER'),
    };
    process.stdout.write('\n' + JSON.stringify(summary) + '\n', () => {
        realExit.call(process, 0);
    });
}, 40);
