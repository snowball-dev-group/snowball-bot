/* import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js";
// import { command, Category } from "./utils/help";
import { getLogger } from "./utils/utils";


class Welcome extends Plugin implements IModule {
	log = getLogger("Welcome");

	constructor() {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		});
	}

	async onMessage(msg: Message) {
		// handling commands
	}

	async init() {
		// initialization
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = Welcome; */