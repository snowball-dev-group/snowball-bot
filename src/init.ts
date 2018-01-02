import logger = require("loggy");
import { SnowballBot, IBotConfig, IInternalBotConfig } from "./types/SnowballBot";
import { join as pathJoin } from "path";
import * as cluster from "cluster";

const coreInfo = {
	"version": "0.9.9986"
};

const SHARD_TIMEOUT = 30000; // ms

(async () => {
	let log = logger(":init");

	let config: IBotConfig;
	try {
		log("info", "[Config] Loading config...");

		const env = (process.env["NODE_ENV"] || "development");

		try {
			config = require(`./config/configuration.${env}.json`);
		} catch(err) {
			log("err", "[Config] Loading config for", env, "failed, attempt to load standard config");
			config = require("./config/configuration.json");
		}
	} catch(err) {
		log("err", err);
		log("err", "[Config] Exiting due we can't start bot without proper config");
		return process.exit(-1);
	}

	log = logger(config.name + ":init");

	log("ok", `[Version] Node ${process.version}`);
	log("ok", `[Version] ${config.name} v${coreInfo.version}`);

	log("info", "[FixConfig] Fixing config...");
	config.localizerOptions.directory = pathJoin(__dirname, config.localizerOptions.directory);

	if(config.shardingOptions && config.shardingOptions.enabled) {
		log("warn", "[Sharding] WARNING: Entering sharding mode!");
		if(cluster.isWorker || (process.env["NODE_ENV"] === "development" && process.env["DEBUG_SHARDS"] === "yes")) {
			if(typeof process.env.SHARD_ID !== "string" || typeof process.env.SHARDS_COUNT !== "string") {
				log("err", "[Sharding] Invalid environment variables!", {
					id: process.env.SHARD_ID || "not set",
					count: process.env.SHARDS_COUNT || "not set"
				});
				process.exit(1);
				return;
			}

			const shardId = parseInt(process.env.SHARD_ID as string, 10);
			const shardsCount = parseInt(process.env.SHARDS_COUNT as string, 10);

			log("info", `[Sharding:Shard~${shardId}] Started as shard ${shardId + 1} / ${process.env.SHARDS_COUNT}`);

			try {
				await initBot(log, config, {
					shardId,
					shardsCount
				});
			} catch(err) {
				log("err", `[Sharding:Shard~${shardId}] Failed to initializate bot`, err);
				return process.exit(1);
			}

			if(process.send) {
				process.send({
					type: "online"
				});
			}
		} else if(cluster.isMaster) {
			const shards = config.shardingOptions.shards;
			if(shards < 0) {
				log("err", "[Sharding:Master] Invalid number of shards");
				process.exit(0);
				return;
			}
			try {
				spawnShards(log, shards);
			} catch(err) {
				log("err", "[Sharding:Master] Could not start some shards", err);
				process.exit(1);
			}
		}
	} else {
		try {
			// continuing loading
			await initBot(log, config, {
				shardId: 0,
				shardsCount: 1
			});
		} catch(err) {
			log("err", "[Run] Failed to initalizate bot", err);
			return process.exit(1);
		}
	}
})();

async function spawnShards(log:any, shardsCount:number) {
	if(cluster.isWorker) {
		throw new Error("Could not spawn shards inside the worker!");
	}

	const clusterRegistry: { [id: string]: cluster.Worker } = {};

	const forwardMessage = (c, msg) => {
		for(const id in clusterRegistry) {
			// no self msg
			if(id === c.id) { continue; }
			clusterRegistry[id].send(msg);
		}
	};

	for(let shardId = 0; shardId < shardsCount; shardId++) {
		log("info", "[Sharding] Spawning shard", shardId + 1);
		// returns shard
		const c = await spawnShard(log, shardId, shardsCount, forwardMessage);
		clusterRegistry[c.id] = c;
	}
}

async function spawnShard(log:any, shardId:number, shardsCount:number, forwardMessage:(c:cluster.Worker, msg:any) => void) : Promise<cluster.Worker> {
	if(cluster.isWorker) {
		throw new Error("Could not spawn shard inside the worker!");
	}

	let shardConnected = false;
	let clusterDied = false;
	const forkedAt = Date.now();

	const env = {
		...process.env,
		"SHARD_ID": shardId + "", "SHARDS_COUNT": shardsCount + ""
	};

	const c = cluster.fork(env).on("online", () => {
		log("info", "[Sharding] Cluster", c.id, "is online");
	}).on("message", (message) => {
		if(typeof message === "object") {
			if(typeof message.type === "string") {
				switch(message.type) {
					case "online": {
						shardConnected = true;
					} break;
					default: {
						log("info", "Forwarding message", message);
						forwardMessage(c, message);
					} break;
				}
			}
		}
	}).on("error", (code, signal) => {
		log("err", "[Sharding] Cluster", c.id, "error received", code, signal);
		clusterDied = true;
	}).on("exit", (code, signal) => {
		log("err", "[Sharding] Cluster", c.id, "died", code, signal);
		clusterDied = true;
	});

	log("info", "[Sharding] Waiting for response from shard", shardId);

	await (new Promise((res, rej) => {
		const id = setInterval(() => {
			if(shardConnected) { res(); clearInterval(id); }
			clusterDied = clusterDied || c.isDead();
			if(clusterDied) {
				clearInterval(id);
				rej("Cluster died");
			}
			if(((Date.now() - forkedAt) > SHARD_TIMEOUT)) {
				clearInterval(id);
				rej("Timed out");
				c.kill("SIGTERM");
			}
		}, 1);
	}));

	log("ok", "[Sharding] Shard repond, continuing spawning...");

	return c;
}

let loadComplete = false;

async function initBot(log:any, config:IBotConfig, internalConfig:IInternalBotConfig) {
	log("info", "[Run] Initializing bot...");
	const snowball = new SnowballBot(config, internalConfig);

	if(!config.ravenUrl) {
		log("info", "[Sentry] Want beautiful reports for bot errors?");
		log("info", "[Sentry] Get your Raven API key at https://sentry.io/");
		log("info", "[Sentry] Put it to `ravenUrl` in your config file");
	} else {
		log("info", "[Sentry] Preparing Raven... Catch 'em all!");
	}
	snowball.prepareRaven();

	log("info", "[Shutdown] Blocking SIGINT");
	process.on("SIGINT", async () => {
		if(!loadComplete) { return false; }
		log("info", "[Shutdown] We're stopping Snowball, please wait a bit...");
		try {
			await snowball.shutdown("interrupted");
			process.exit(0);
		} catch (err) {
			log("err", "[Shutdown] Shutdown complete with an error", err);
			process.exit(-1);
		}
	});

	process.on("exit", () => {
		log("info", "[Shutdown] Bye! <3");
	});

	log("info", "[Run] Preparing our Discord client");
	snowball.prepareDiscordClient();

	process.on("uncaughtException", (err) => {
		log("err", "[Run] Error", err);
		process.exit(1);
	});

	try {
		log("info", "[Run] Connecting...");
		await snowball.login();

		log("ok", "[Run] Successfully connected, preparing our localizer...");
		await snowball.prepareLocalizator();

		log("ok", "[Run] Localizer prepared, preparing module loader...");
		await snowball.prepareModLoader();

		log("ok", "[Run] ====== DONE ======");
		loadComplete = true;
	} catch(err) {
		log("err", "[Run] Can't start bot", err);
		log("err", "[Run] Exiting due we can't work without bot connected to Discord");
		process.exit(1);
	}
}
