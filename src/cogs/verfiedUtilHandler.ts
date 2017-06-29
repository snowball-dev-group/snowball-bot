import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { messageEvent, guildMemberAddEvent, guildMemberRemoveEvent, init } from "./utils/verified";
import { getLogger } from "./utils/utils";

class VerifiedUtilHandler extends Plugin implements IModule {
    log = getLogger("VerifiedHandler");

    constructor() {
        super({
            "message": messageEvent,
            "guildMemberAdd": guildMemberAddEvent,
            "guildMemberRemove": guildMemberRemoveEvent
        }, true);
        this.initnHandle();
    }

    async initnHandle() {
        if(await init()) {
            this.log("ok", "Initialization done, handling events");
            this.handleEvents();
        } else {
            this.log("err", "Initialization failed");
        }
    }

    async unload() {
        this.unhandleEvents();
        return true;
    }
}

module.exports = VerifiedUtilHandler;