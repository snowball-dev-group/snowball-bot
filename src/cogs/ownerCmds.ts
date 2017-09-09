import { IModule } from "../types/ModuleLoader";
import logger = require("loggy");
import { Plugin } from "./plugin";
import { Message } from "discord.js";
import { generateLocalizedEmbed } from "./utils/ez-i18n";
import { commandRedirect, objectToMap, EmbedType, escapeDiscordMarkdown } from "./utils/utils";
import { default as fetch } from "node-fetch";

class OwnerCommands extends Plugin implements IModule {
	log: Function = logger("OwnerCMDs");

	constructor() {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		});
	}

	async onMessage(msg: Message) {
		if(!msg.author) { return; }
		if(msg.author.id !== botConfig.botOwner) { return; }
		let u = msg.member || msg.author;
		commandRedirect(msg.content, objectToMap<Function>({
			"!change_name": async (username) => {
				try {
					let oldName = discordBot.user.username;
					let newUser = await discordBot.user.setUsername(username);
					msg.react("✅");
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.OK, u, {
							key: "OWNERCMDS_CHANGENAME_DONE",
							formatOptions: {
								oldName: escapeDiscordMarkdown(oldName, true),
								newName: escapeDiscordMarkdown(newUser.username, true)
							}
						})
					});
				} catch(err) {
					msg.react("🚫");
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, u, {
							key: "OWNERCMDS_CHANGENAME_FAULT",
							formatOptions: {
								errMessage: err.message
							}
						})
					});
				}
			},
			"!change_avy": async () => {
				try {
					let resp = await fetch(msg.attachments.first().url);
					if(resp.status !== 200) {
						msg.channel.send("", {
							embed: await generateLocalizedEmbed(EmbedType.Progress, u, "OWNERCMDS_CHANGEAVY_FAULT_RESPERR")
						});
						return;
					}
					try {
						let newUser = await discordBot.user.setAvatar(await resp.buffer());
						msg.channel.send("", {
							embed: await generateLocalizedEmbed(EmbedType.OK, u, "OWNERCMDS_CHANGEAVY_DONE", {
								imageUrl: newUser.displayAvatarURL
							})
						});
					} catch(err) {
						msg.channel.send("", {
							embed: await generateLocalizedEmbed(EmbedType.Error, u, {
								key: "OWNERCMDS_CHANGEAVY_FAULT_SETFAILED",
								formatOptions: {
									errMessage: err.message
								}
							})
						});
					}
				} catch(err) {
					this.log("err", "Error downloading avy");
					msg.channel.send("", {
						embed: await generateLocalizedEmbed(EmbedType.Error, u, {
							key: "OWNERCMDS_CHANGEAVY_FAULT_REQERROR",
							formatOptions: {
								errMsg: err.message
							}
						})
					});
				}
			}
		}));
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = OwnerCommands;