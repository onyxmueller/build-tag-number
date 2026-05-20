'use strict';

const path = require('path');
const { fork } = require('child_process');

const ACTION_MAIN = path.resolve(__dirname, '..', '..', 'main.js');
const CHILD = path.resolve(__dirname, 'child_runner.js');

function runAction(opts = {}) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ actionMain: ACTION_MAIN, ...opts });
        const child = fork(CHILD, [payload], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: { ...process.env, NODE_OPTIONS: '' },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', reject);
        child.on('exit', () => {
            const lines = stdout.trimEnd().split('\n');
            const last = lines[lines.length - 1];
            try {
                const summary = JSON.parse(last);
                summary.stdout = stdout;
                summary.stderr = stderr;
                resolve(summary);
            } catch (e) {
                reject(new Error(
                    `Could not parse child summary as JSON.\n` +
                    `stdout:\n${stdout}\nstderr:\n${stderr}`
                ));
            }
        });
    });
}

module.exports = { runAction };
