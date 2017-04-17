import logger = require("loggy");
import { SnowballBot, IBotConfig } from "./types/SnowballBot";

const coreInfo = {
    "version": "0.1.6"
};

(() => {
    let log = logger(":init");

    let config:IBotConfig;
    try {
        log("info", "Loading config...");
        config = require("./config/configuration.json");
    } catch (err) {
        log("err", err);
        log("err", "Exiting due we can't start bot without proper config");
        return process.exit(-1);
    }

    log = logger(config.name + ":init");

    log("ok", `Node ${process.version}`)
    log("ok", `${config.name} v${coreInfo.version}`);

    log("info", "Initializing bot...");
    const Snowball = new SnowballBot(config);

    log("info", "Preparing our Discord client");
    Snowball.prepareDiscordClient();

    log("info", "Connecting...");
    Snowball.connect().then(() => {
        log("ok", "Successfully connected, preparing our module loader");
        Snowball.prepareModLoader();
    }, (err) => {
        log("err", "Can't connect to Discord", err);
        log("err", "Exiting due we can't work without bot connected to Discord");
        process.exit(1);
    });
})();