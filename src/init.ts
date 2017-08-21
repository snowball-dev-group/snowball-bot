import logger = require("loggy");
import { SnowballBot, IBotConfig, IInternalConfig } from "./types/SnowballBot";
import { join as pathJoin } from "path";
import * as minimalist from "minimist";
import * as cluster from "cluster";
import * as stream from "stream";

const coreInfo = {
    "version": "0.9.996-prerelease"
};

const SHARD_TIMEOUT = 30000; // ms

(async () => {
    let log = logger(":init");

    let config: IBotConfig;
    try {
        log("info", "Loading config...");
        config = require("./config/configuration.json");
    } catch(err) {
        log("err", err);
        log("err", "Exiting due we can't start bot without proper config");
        return process.exit(-1);
    }

    log = logger(config.name + ":init");

    log("ok", `Node ${process.version}`);
    log("ok", `${config.name} v${coreInfo.version}`);

    log("info", "Fixing config...");
    config.localizerOptions.directory = pathJoin(__dirname, config.localizerOptions.directory);

    if(config.shardingOptions && config.shardingOptions.enabled) {
        log("warn", "WARNING: Entering sharding mode!");
        if(cluster.isWorker || (process.env["NODE_ENV"] === "development" && process.env["DEBUG_SHARDS"] === "yes")) {
            if(typeof process.env.SHARD_ID !== "string" || typeof process.env.SHARDS_COUNT !== "string") {
                log("err", "Invalid environment variables", {
                    first: process.env.SHARD_ID || "not set",
                    second: process.env.SHARDS_COUNT || "not set"
                });
                process.exit(1);
                return;
            }

            log("info", "Started as shard", process.env.SHARD_ID, "/", process.env.SHARDS_COUNT);

            await initBot(log, config, {
                // "as" because fuck typescript, check above for him means nothing
                shardId: parseInt(process.env.SHARD_ID as string, 10),
                shardsCount: parseInt(process.env.SHARDS_COUNT as string, 10)
            });

            if(process.send) {
                process.send({
                    type: "online"
                });
            }
        } else if(cluster.isMaster) {
            let shards = config.shardingOptions.shards;
            if(shards < 0) {
                log("err", "Invalid number of shards");
                process.exit(0);
                return;
            }
            try {
                spawnShards(log, config, shards);
            } catch(err) {
                log("err", "Could not start some shards", err);
                process.exit(1);
            }
        }
    } else {
        // continuing loading
        await initBot(log, config, {
            shardId: 0,
            shardsCount: 1
        });
    }
})();

async function spawnShards(log:any, config:IBotConfig, shardsCount:number) {
    if(cluster.isWorker) {
        throw new Error("Could not spawn shards inside the worker!");
    }

    for(let shardId = 0; shardId < shardsCount; shardId++) {
        log("info", "Spawning shard", shardId);
        await spawnShard(log, config, shardId, shardsCount);
    }
}

async function spawnShard(log:any, config:IBotConfig, shardId:number, shardsCount:number) {
    if(cluster.isWorker) {
        throw new Error("Could not spawn shard inside the worker!");
    }

    let shardConnected = false;
    let clusterDied = false;
    let forkedAt = Date.now();

    let env = {
        ...process.env,
        "SHARD_ID": shardId + "", "SHARDS_COUNT": shardsCount + ""
    };

    let c = cluster.fork(env).on("online", () => {
        log("info", "Cluster", c.id, "is online");
    }).on("message", (message) => {
        if(typeof message === "object") {
            if(typeof message.type === "string") {
                switch(message.type) {
                    case "stdin": {
                        console.log(`[SHARD:${shardId}] ${message.data.replace("\r", "")}`);
                    } break;
                    case "stderr": {
                        console.log(`[SHARD:${shardId}] ${message.data.replace("\r", "")}`);
                    } break;
                    case "online": {
                        shardConnected = true;
                    } break;
                }
            }
        }
    }).on("error", (code, signal) => {
        log("err", "Cluster", c.id, "error received", code, signal);
        clusterDied = true;
    }).on("exit", (code, signal) => {
        log("err", "Cluster", c.id, "died", code, signal);
        clusterDied = true;
    });

    log("info", "Waiting for response from shard", shardId);

    await (new Promise((res, rej) => {
        let id = setInterval(() => {
            if(shardConnected) { res(); clearInterval(id); }
            clusterDied = clusterDied || c.isDead();
            if(clusterDied) {
                clearInterval(id);
                rej("Cluster died");
            }
            if(((Date.now() - forkedAt) > SHARD_TIMEOUT)) {
                clearInterval(id);
                rej("Timed out");
            }
        }, 1);
    }));

    log("ok", "Shard repond, continuing spawning");
}

async function initBot(log:any, config:IBotConfig, internalConfig:IInternalConfig) {
    log("info", "Initializing bot...");
    const Snowball = new SnowballBot(config, internalConfig);

    log("info", "Preparing our Discord client");
    Snowball.prepareDiscordClient();

    process.on("uncaughtException", (err) => {
        log("err", "Error", err);
        process.exit(1);
    });

    try {
        log("info", "Connecting...");
        await Snowball.connect();

        log("ok", "Successfully connected, preparing our localizer...");
        await Snowball.prepareLocalizator();

        log("ok", "Localizer prepared, preparing module loader...");
        await Snowball.prepareModLoader();

        log("ok", "====== DONE ======");
    } catch(err) {
        log("err", "Can't start bot", err);
        log("err", "Exiting due we can't work without bot connected to Discord");
        process.exit(1);
    }
}