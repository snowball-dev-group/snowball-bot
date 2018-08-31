import { SnowballBot, IBotConfig, IInternalBotConfig } from "./types/SnowballBot";
import { join as pathJoin } from "path";
import * as cluster from "cluster";
import * as logger from "loggy";
import * as Bluebird from "bluebird";

const CORE_INFO = {
	"version": "0.9.9986"
};

// Time until marking process as timed out and therefore killing it
const SHARD_TIMEOUT = 30000; // ms

// All handled exit signals
const EXIT_SIGNALS: NodeJS.Signals[] = [
	"SIGTERM",
	"SIGINT",
	"SIGQUIT",
	"SIGHUP"
	// No SIGKILL here, because... you know... it kills
];

// How many signals required to abort loading and shutdown
// The minumum number of required signals is two (2)
// The maximum is ten (10)
const EXIT_ABORT_SIGNALS_REQUIRED = 3;

// How much time signal is counted
// After such time signal will not be counted anymore
const EXIT_ABORT_SIGNALS_TTL = 3000; // ms

(async () => {
	let log = logger(":init");
	logger.setAsync(false);

	let config: IBotConfig;
	try {
		log("info", "[Config] Loading config...");

		const env = (process.env.NODE_ENV || "development");

		try {
			config = require(`./config/configuration.${env}.json`);
		} catch (err) {
			log("err", "[Config] Loading config for", env, "failed, attempt to load standard config");
			config = require("./config/configuration.json");
		}
	} catch (err) {
		log("err", err);
		log("err", "[Config] Exiting due we can't start bot without proper config");

		return process.exit(-1);
	}

	log = logger(`${config.name}:init`);

	log("ok", `[Version] Node ${process.version}`);
	log("ok", `[Version] ${config.name} v${CORE_INFO.version}`);

	log("info", "[FixConfig] Fixing config...");
	config.localizerOptions.directory = pathJoin(__dirname, config.localizerOptions.directory);

	if (EXIT_ABORT_SIGNALS_REQUIRED < 2 && EXIT_ABORT_SIGNALS_REQUIRED > 10) {
		throw new Error("Invalid number of requited signals count until hard shutdown while loading");
	}

	if (config.shardingOptions && config.shardingOptions.enabled) {
		log("warn", "[Sharding] WARNING: Entering sharding mode!");
		if (cluster.isWorker || (process.env.NODE_ENV === "development" && process.env.DEBUG_SHARDS === "yes")) {
			if (typeof process.env.SHARD_ID !== "string" || typeof process.env.SHARDS_COUNT !== "string") {
				log("err", "[Sharding] Invalid environment variables!", {
					id: process.env.SHARD_ID || "not set",
					count: process.env.SHARDS_COUNT || "not set"
				});

				return process.exit(1);
			}

			const shardId = parseInt(process.env.SHARD_ID, 10);
			const shardsCount = parseInt(process.env.SHARDS_COUNT, 10);

			log("info", `[Sharding:Shard~${shardId}] Started as shard ${shardId + 1} / ${process.env.SHARDS_COUNT}`);

			try {
				await initBot(log, config, {
					shardId,
					shardsCount
				});
			} catch (err) {
				log("err", `[Sharding:Shard~${shardId}] Failed to initializate bot`, err);

				return process.exit(1);
			}

			if (process.send) {
				process.send({
					type: "online"
				});
			}
		} else if (cluster.isMaster) {
			const shards = config.shardingOptions.shards;
			if (shards < 0) {
				log("err", "[Sharding:Master] Invalid number of shards");

				return process.exit(0);
			}
			try {
				spawnShards(log, shards);
			} catch (err) {
				log("err", "[Sharding:Master] Could not start some shards", err);

				return process.exit(1);
			}
		}
	} else {
		try {
			// continuing loading
			await initBot(log, config, {
				shardId: 0,
				shardsCount: 1
			});
		} catch (err) {
			log("err", "[Run] Failed to initalizate bot", err);

			return process.exit(1);
		}
	}
})();

async function spawnShards(log: logger.ILogFunction, shardsCount: number) {
	if (cluster.isWorker) {
		throw new Error("Could not spawn shards inside the worker!");
	}

	const clusterRegistry: { [id: string]: cluster.Worker } = Object.create(null);

	const forwardMessage = (c: any, msg: any) => {
		for (const id in clusterRegistry) {
			// no self msg
			if (id === c.id) { continue; }
			clusterRegistry[id].send(msg);
		}
	};

	for (let shardId = 0; shardId < shardsCount; shardId++) {
		log("info", "[Sharding] Spawning shard", shardId + 1);
		// returns shard
		const c = await spawnShard(log, shardId, shardsCount, forwardMessage);
		clusterRegistry[c.id] = c;
	}
}

async function spawnShard(log: logger.ILogFunction, shardId: number, shardsCount: number, forwardMessage: (c: cluster.Worker, msg: any) => void): Promise<cluster.Worker> {
	if (cluster.isWorker) {
		throw new Error("Could not spawn shard inside the worker!");
	}

	let shardConnected = false;
	let clusterDied = false;

	const forkedAt = Date.now();

	const env = {
		...process.env,
		"SHARD_ID": `${shardId}`, "SHARDS_COUNT": `${shardsCount}`
	};

	const c = cluster
		.fork(env)
		.on("online", () => {
			log("info", `[Sharding] Cluster ${c.id} online`);
		})
		.on("message", (message) => {
			if (typeof message !== "object" && typeof message.type !== "string") { return; }

			if (message.type === "online") {
				shardConnected = true;

				return;
			}

			log("info", "[Sharding] Forwarding message", message);
			forwardMessage(c, message);
		})
		.on("error", (code, signal) => {
			log("err", `[Sharding] Cluster ${c.id}`);
			log("err", "[Sharding] Cluster", c.id, "error received", code, signal);
			clusterDied = true;
		})
		.on("exit", (code, signal) => {
			log("err", "[Sharding] Cluster", c.id, "died", code, signal);
			clusterDied = true;
		});

	log("info", "[Sharding] Waiting for response from shard", shardId);

	await (new Promise((res, rej) => {
		const id = setInterval(() => {
			if (shardConnected) {
				res();
				clearInterval(id);
			}

			clusterDied = clusterDied || c.isDead();

			if (clusterDied) {
				clearInterval(id);
				rej("Cluster died");
			}

			if (((Date.now() - forkedAt) < SHARD_TIMEOUT)) {
				return;
			}

			clearInterval(id);
			rej("Timed out");
			c.kill("SIGTERM");
		}, 1);
	}));

	log("ok", "[Sharding] Shard repond, continuing spawning...");

	return c;
}

let isLoadingComplete = false;
let exitSignalsReceived = 0;

const EXIT_QUOTES = [
	// Full stop like complete *death*.
	// It is so sad. Alexa, play Mad World
	"I don't blame you.",
	"Shutting down.",
	"I don't hate you.",
	"Whyyyyy",
	"Goodnight.",
	"Goodbye."
];

async function initBot(log: logger.ILogFunction, config: IBotConfig, internalConfig: IInternalBotConfig) {
	log("info", "[Run] Preparation...");

	await prepare(log);

	log("info", "[Run] Initializing bot...");
	const snowball = new SnowballBot(config, internalConfig);

	if (!config.ravenUrl) {
		log("info", "[Sentry] Want beautiful reports for bot errors?");
		log("info", "[Sentry] Get your Raven API key at https://sentry.io/");
		log("info", "[Sentry] Put it to `ravenUrl` in your config file");
	} else {
		log("info", "[Sentry] Preparing Raven... Catch 'em all!");
	}

	snowball.prepareRaven();

	log("info", "[Exit Events] Handling exit events...");

	const exitCallback = async (exitSignal: string) => {
		exitSignalsReceived++;

		setTimeout(() => exitSignalsReceived--, EXIT_ABORT_SIGNALS_TTL);

		log("info", `[Exit Events] Acknowledge of "${exitSignal}" signal`);

		if (!isLoadingComplete) {
			log("warn", `[Exit Events] The bot hasn't finished loading yet, therefore cannot be shutdown gracefully`);
			log("info", `[Exit Events] You can make hard shutdown by sending ${EXIT_ABORT_SIGNALS_REQUIRED} signals`);
		}

		if (exitSignalsReceived > 1) {
			log("warn", `[Exit Events] ${exitSignalsReceived} / 5 signals to hard shutdown`);

			if (exitSignalsReceived === 2) {
				log("warn", "[Exit Events] Beware: hard shutdown may lead to unexpected results including data loss!");
			}

			if (exitSignalsReceived < EXIT_ABORT_SIGNALS_REQUIRED) { return false; }

			log("ok", "[Shutdown] No hard feelings.");

			return process.kill(process.pid, "SIGKILL");
		}

		logger.setAsync(false);

		log("info", "[Shutdown] We're stopping Snowball Bot, please wait a bit...");

		try {
			await snowball.shutdown(`shutdown: ${exitSignal}`);
			process.exit(0);
		} catch (err) {
			log("err", "[Shutdown] Shutdown complete with an error", err);
			process.exit(-1);
		}
	};

	for (let i = 0, l = EXIT_SIGNALS.length; i < l; i++) {
		const signal = EXIT_SIGNALS[i];

		process.on(signal, () => exitCallback(signal));
	}

	process.on("exit", () => {
		const quoteNumber = Math.floor(
			Math.random() * EXIT_QUOTES.length
		);

		log("ok", `[Shutdown] ${EXIT_QUOTES[quoteNumber]}`);
	});

	log("info", "[Run] Preparing our Discord client");
	snowball.prepareDiscordClient();

	process.on("uncaughtException", (err) => {
		logger.setAsync(false);
		log("err", "[Run] Error", err);
		process.exit(1);
	});

	try {
		log("info", "[Run] Connecting...");
		await snowball.login();

		log("ok", "[Run] Successfully connected, preparing our localizer...");
		await snowball.prepareLocalizator();

		logger.setAsync(false);

		log("ok", "[Run] Localizer prepared, preparing module loader...");
		await snowball.prepareModLoader();

		log("ok", "[Run] Recalculating language coverages after modules loading...");
		await $localizer.calculateCoverages(undefined, true);

		log("ok", "[Run] ====== DONE ======");
		isLoadingComplete = true;
	} catch (err) {
		log("err", "[Run] Can't start bot", err);
		log("err", "[Run] Exiting due we can't work without bot connected to Discord");
		process.exit(1);
	}
}

async function prepare(log: logger.ILogFunction) {
	prepareAliases(log);

	setupBluebird(log);
}

function prepareAliases(log: logger.ILogFunction) {
	log("info", "[Import Aliases] Registering aliases for commont paths");

	const aliasModule = require("module-alias");

	const currentDirectory = process.cwd();

	aliasModule.addAliases({
		// ! DON'T FORGET ABOUT TSCONFIG
		"@sb-types": pathJoin(currentDirectory, "types"),
		"@cogs": pathJoin(currentDirectory, "cogs"),
		"@utils": pathJoin(currentDirectory, "utils")
	});

	log("ok", "[Import Aliases] Aliases registered");
}

function setupBluebird(log) {
	log("info", "[Bluebird] Configuring bluebird");

	Bluebird.config({
		warnings: true,
		longStackTraces: true,
		cancellation: true
	});
}
