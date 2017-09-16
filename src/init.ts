import logger = require("loggy");
import { SnowballBot, IBotConfig, IInternalBotConfig } from "./types/SnowballBot";
import { join as pathJoin } from "path";
import * as cluster from "cluster";

const coreInfo = {
	"version": "0.9.996-prerelease"
};

const SHARD_TIMEOUT = 30000; // ms

(async () => {
	let log = logger(":init");

	let config: IBotConfig;
	try {
		log("info", "Loading config...");

		let env = (process.env["NODE_ENV"] || "development");

		try {
			config = require(`./config/configuration.${env}.json`);
		} catch(err) {
			log("err", "Loading config for", env, "failed, attempt to load standard config");
			config = require("./config/configuration.json");
		}
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
					id: process.env.SHARD_ID || "not set",
					count: process.env.SHARDS_COUNT || "not set"
				});
				process.exit(1);
				return;
			}

			let shardId = parseInt(process.env.SHARD_ID as string, 10);
			let shardsCount = parseInt(process.env.SHARDS_COUNT as string, 10);

			log("info", "Started as shard", shardId + 1, "/", process.env.SHARDS_COUNT);

			try {
				await initBot(log, config, {
					shardId,
					shardsCount
				});
			} catch(err) {
				log("err", "Failed to initializate bot", err);
				return process.exit(1);
			}

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
				spawnShards(log, shards);
			} catch(err) {
				log("err", "Could not start some shards", err);
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
			log("err", "Failed to initalizate bot", err);
			return process.exit(1);
		}
	}
})();

async function spawnShards(log:any, shardsCount:number) {
	if(cluster.isWorker) {
		throw new Error("Could not spawn shards inside the worker!");
	}

	let clusterRegistry: { [id: string]: cluster.Worker } = {};

	let forwardMessage = (c, msg) => {
		for(let id in clusterRegistry) {
			// no self msg
			if(id === c.id) { continue; }
			clusterRegistry[id].send(msg);
		}
	};

	for(let shardId = 0; shardId < shardsCount; shardId++) {
		log("info", "Spawning shard", shardId + 1);
		// returns shard
		let c = await spawnShard(log, shardId, shardsCount, forwardMessage);
		clusterRegistry[c.id] = c;
	}
}

async function spawnShard(log:any, shardId:number, shardsCount:number, forwardMessage:(c:cluster.Worker, msg:any) => void) : Promise<cluster.Worker> {
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

	return c;
}

async function initBot(log:any, config:IBotConfig, internalConfig:IInternalBotConfig) {
	log("info", "Initializing bot...");
	const snowball = new SnowballBot(config, internalConfig);

	if(!config.ravenUrl) {
		log("info", "Want beautiful reports for bot errors?");
		log("info", "Get your Raven API key at https://sentry.io/");
		log("info", "Put it to `ravenUrl` in your config file");
	} else {
		log("info", "Preparing Raven... Catch 'em all!");
	}
	await snowball.prepareRaven();

	log("info", "Preparing our Discord client");
	snowball.prepareDiscordClient();

	process.on("uncaughtException", (err) => {
		log("err", "Error", err);
		process.exit(1);
	});

	try {
		log("info", "Connecting...");
		await snowball.connect();

		log("ok", "Successfully connected, preparing our localizer...");
		await snowball.prepareLocalizator();

		log("ok", "Localizer prepared, preparing module loader...");
		await snowball.prepareModLoader();

		log("ok", "====== DONE ======");
	} catch(err) {
		log("err", "Can't start bot", err);
		log("err", "Exiting due we can't work without bot connected to Discord");
		process.exit(1);
	}
}