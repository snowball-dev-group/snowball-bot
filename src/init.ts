import logger = require("loggy");
import { SnowballBot, IBotConfig } from "./types/SnowballBot";
import { join as pathJoin } from "path";

const coreInfo = {
    "version": "0.9.93-rc5"
};

(async () => {
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

    log("ok", `Node ${process.version}`);
    log("ok", `${config.name} v${coreInfo.version}`);

    log("info", "Fixing config...");
    config.localizerOptions.directory = pathJoin(__dirname, config.localizerOptions.directory);

    log("info", "Initializing bot...");
    const Snowball = new SnowballBot(config);

    log("info", "Preparing our Discord client");
    Snowball.prepareDiscordClient();

    

    log("info", "Connecting...");
    try {
        await Snowball.connect();
        log("ok", "Successfully connected, preparing our localizer...");
        await Snowball.prepareLocalizator();

        log("ok", "Localizer prepared, preparing module loader...");
        Snowball.prepareModLoader();

        log("ok", "====== DONE ======");
    } catch (err) {
        log("err", "Can't connect to Discord", err);
        log("err", "Exiting due we can't work without bot connected to Discord");
        process.exit(1);
    }
})();