import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { messageEvent, guildMemberAddEvent, guildMemberRemoveEvent, init } from "../utils/verified";
import * as getLogger from "loggy";

class VerifiedUtilHandler extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.verified.handler";
	}

	log = getLogger("VerifiedHandler");

	constructor() {
		super({
			"message": messageEvent,
			"guildMemberAdd": guildMemberAddEvent,
			"guildMemberRemove": guildMemberRemoveEvent
		}, true);
	}

	async init() {
		if (await init()) {
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
