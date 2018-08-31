import * as Redis from "ioredis";
import * as getLogger from "loggy";

let redisClient: undefined | Redis.Redis = undefined;

const REDIS_DEFAULT_PORT = 6379;
const REDIS_DEFAULT_HOST = "127.0.0.1";
const LOG = getLogger("Utils:Redis");

export async function getRedisClient() {
	if (!redisClient) {
		LOG("info", "[Get Client] Client not found, init cycle start...");
		redisClient = await init();
	}

	return redisClient;
}

async function init() {
	const portOverride = parseInt(process.env.REDIS_PORT!, 10);
	const hostOverride = process.env.REDIS_HOST;
	const passwordOverride = process.env.REDIS_PASSWD;

	if (!portOverride) {
		LOG("info", `[Init] Port override is not presented, using '${REDIS_DEFAULT_PORT}'`);
	}
	if (!hostOverride) {
		LOG("info", `[Init] Host override is not presented, using '${REDIS_DEFAULT_HOST}'`);
	}

	redisClient = createRedisClient(isNaN(portOverride) ? REDIS_DEFAULT_PORT : portOverride, hostOverride ? hostOverride : REDIS_DEFAULT_HOST, {
		password: passwordOverride
	});

	return redisClient;
}

export function createRedisClient(port?: number, host?: string, options?: Redis.RedisOptions) {
	if (options && !options.password) {
		LOG("warn", "[Client Creation] It's highly recommended to have password set.");
	}

	return new Redis(port || REDIS_DEFAULT_PORT, host || REDIS_DEFAULT_HOST, options);
}
