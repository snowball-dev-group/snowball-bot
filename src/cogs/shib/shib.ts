import { IModule } from "@sb-types/ModuleLoader/ModuleLoader";
import { Plugin } from "../plugin";
import { Message } from "discord.js";

class SHIBCHANNEL extends Plugin implements IModule {
	public get signature() {
		return "dafri.interactive.shibs";
	}

	constructor() {
		super({
			"message": (msg: Message) => this._onMessage(msg),
			"messageUpdate": (old, newMsg: Message) => this._onMessageUpdated(old, newMsg)
		});
	}

	private async _onMessageUpdated(oldMessage: Message, newMessage: Message) {
		if (oldMessage.channel.id !== "300019335055802368") { return; }

		return this._onMessage(newMessage);
	}

	private async _onMessage(msg: Message) {
		if (msg.channel.id !== "300019335055802368") { return; }
		if (!msg.author) {
			return msg.delete();
		}

		if (msg.author.id === "235849760253280257") { return; }
		if (msg.content !== "!shib" && msg.attachments.size < 1) {
			return msg.delete();
		}
	}

	public async unload() {
		this.unhandleEvents();

		return true;
	}
}

module.exports = SHIBCHANNEL;
