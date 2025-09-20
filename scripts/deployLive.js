#!/usr/bin/env ts-node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
async function main() {
    if ((process.env.PAPER_MODE ?? '').toLowerCase() === 'true') {
        console.error('[Deploy] PAPER_MODE must be false/blank to promote live.');
        process.exit(1);
    }
    if (process.env.PROMOTE_CONFIRM !== 'I_ACKNOWLEDGE_RISK') {
        console.error('[Deploy] Set PROMOTE_CONFIRM=I_ACKNOWLEDGE_RISK to run live promotion.');
        process.exit(1);
    }
    console.log('[Deploy] Promoting to live...');
    const env = { ...process.env, PAPER_MODE: 'false', SUMMARY_ONLY: 'false' };
    const build = (0, child_process_1.spawn)('npm', ['run', 'build'], { stdio: 'inherit', env });
    await new Promise((resolve, reject) => {
        build.on('exit', (code) => (code === 0 ? resolve(null) : reject(new Error(`build exited ${code}`))));
    });
    const run = (0, child_process_1.spawn)('node', ['dist/index.js'], { stdio: 'inherit', env });
    run.on('exit', (code) => {
        if (code === 0) {
            console.log('[Deploy] Live deployment finished.');
        }
        else {
            console.error('[Deploy] Live deployment exited with code', code);
        }
    });
}
main().catch((err) => {
    console.error('[Deploy] Failed:', err);
    process.exit(1);
});
