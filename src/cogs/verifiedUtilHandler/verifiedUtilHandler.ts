import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { Plugin } from "../plugin";
import { messageEvent, guildMemberAddEvent, guildMemberRemoveEvent, init } from "@utils/verified";
import * as getLogger from "loggy";

class VerifiedUtilHandler extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.verified.handler";
	}

	private readonly _log = getLogger("VerifiedHandler");

	constructor() {
		super({
			"message": messageEvent,
			"guildMemberAdd": guildMemberAddEvent,
			"guildMemberRemove": guildMemberRemoveEvent
		}, true);
	}

	public async init() {
		if (await init()) {
			this._log("ok", "Initialization done, handling events");
			this.handleEvents();
		} else {
			this._log("err", "Initialization failed");
		}
	}

	public async unload() {
		this.unhandleEvents();

		return true;
	}
}

module.exports = VerifiedUtilHandler;
