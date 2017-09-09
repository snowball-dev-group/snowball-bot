import { IModule } from "../types/ModuleLoader";
import { Plugin } from "./plugin";
import { Message } from "discord.js";

class SHIBCHANNEL extends Plugin implements IModule {

	constructor() {
		super({
			"message": (msg: Message) => this.onMessage(msg),
			"messageUpdate": (old, newMsg: Message) => this.onMessageUpdated(old, newMsg)
		});
	}

	async onMessageUpdated(oldMessage:Message, newMessage:Message) {
		if(oldMessage.channel.id !== "300019335055802368") { return; }
		return await this.onMessage(newMessage);
	}

	async onMessage(msg: Message) {
		if(msg.channel.id !== "300019335055802368") { return; }
		if(!msg.author) { msg.delete(); return; }
		if(msg.author.id === "235849760253280257") { return; }
		if(msg.content !== "!shib" && msg.attachments.size < 1) { msg.delete(); }
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = SHIBCHANNEL;