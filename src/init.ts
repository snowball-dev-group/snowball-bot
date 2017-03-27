import logger = require("loggy");
import { BlackSilverBot, IBotConfig } from "./types/BlackSilverBot";

const coreInfo = {
    "version": "0.1.5"
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
    const BSB = new BlackSilverBot(config);

    log("info", "Preparing our Discord client");
    BSB.prepareDiscordClient();

    log("info", "Connecting...");
    BSB.connect().then(() => {
        log("ok", "Successfully connected, preparing our module loader");
        BSB.prepareModLoader();
    }, (err) => {
        log("err", "Can't connect to Discord", err);
        log("err", "Exiting due we can't work without bot connected to Discord");
        process.exit(1);
    });
})();