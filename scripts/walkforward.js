#!/usr/bin/env ts-node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
function runStage(stage) {
    const command = stage.command ?? 'npm run backtest';
    const [cmd, ...args] = command.split(' ');
    const env = { ...process.env, ...(stage.env || {}) };
    console.log(`\n[WalkForward] Stage: ${stage.name}`);
    console.log(`Command: ${command}`);
    const result = (0, child_process_1.spawnSync)(cmd, args, {
        stdio: 'inherit',
        env,
    });
    if (result.status !== 0) {
        throw new Error(`Stage '${stage.name}' failed with exit code ${result.status}`);
    }
}
function main() {
    const configPath = process.env.WALKFORWARD_CONFIG || path_1.default.resolve('configs', 'walkforward.json');
    if (!(0, fs_1.existsSync)(configPath)) {
        console.error(`Walk-forward config not found: ${configPath}`);
        process.exit(1);
    }
    const config = JSON.parse((0, fs_1.readFileSync)(configPath, 'utf8'));
    if (!config.stages || !config.stages.length) {
        console.error('No stages defined in walk-forward config');
        process.exit(1);
    }
    for (const stage of config.stages) {
        runStage(stage);
    }
    console.log('\nWalk-forward workflow completed.');
}
main();
