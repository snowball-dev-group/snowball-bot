import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, GuildMember, User } from "discord.js";
import { Context } from "vm";
import { EmbedType, getLogger } from "../utils/utils";
import util = require("util");
import VM = require("vm");
import { generateLocalizedEmbed } from "../utils/ez-i18n";
import { replaceAll } from "../utils/text";

const PREFIX = "``";
const PREFIX_LENGTH = PREFIX.length;

class EvalJS extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.eval";
	}

	log = getLogger("EvalJS");

	constructor() {
		super({
			"message": (msg: Message) => this.onMessage(msg)
		});
	}

	safeEval(script: string, context: Context) {
		const s = new VM.Script(script);
		const c = VM.createContext(context);
		return s.runInContext(c, {
			timeout: 5000,
			displayErrors: true
		});
	}

	/**
	 * Making our function a bit safe
	 * @param cb Function that will be called
	 */
	makeSafe(cb) {
		return () => {
			try {
				cb();
			} catch(err) {
				this.log("err", "Safe function calling thrown an error", err);
			}
		};
	}

	async onMessage(message: Message) {
		if(!message.author) { return; }
		if(message.author.id !== $botConfig.botOwner) { return; }
		if(!message.content) { return; }

		const usedPrefix = ["!eval", "!e", "!ev"].find(prefix => message.content.startsWith(prefix));
		if(!usedPrefix) { return; }

		const afterCmd = message.content.slice(`${usedPrefix} `.length).trim();
		if(!afterCmd.startsWith(PREFIX) || !afterCmd.endsWith(PREFIX)) { return; }

		// Parsing our script
		const script = afterCmd.substring(PREFIX_LENGTH, afterCmd.length - PREFIX_LENGTH);

		const user = message.member || message.author;

		let resultMsg: Message;
		try {
			resultMsg = await message.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Information, user, {
					custom: true,
					string: "Please wait, we're executing code in current shard. It may take some time."
				}, {
						informationTitle: "Executing..."
					})
			}) as Message;
		} catch(err) {
			this.log("err", "Can't send message with output:", err);
			return;
		}

		const startTime = Date.now();
		try {
			// Trying to run it
			// Actually, it named `safeEval` but it's absolutely not safe
			// For example, if you set timer and throw error there

			const output = this.safeEval(script, {
				...global,
				this: this,
				$bot: $discordBot,
				$msg: message,
				setTimeout: (handler, ms) => setTimeout(this.makeSafe(handler), ms),
				setInterval: (handler, ms) => setInterval(this.makeSafe(handler), ms),
				require: require,
				process: undefined // should not have access to process thread
			});

			const isPromise = output.constructor.name === "Promise";

			if(isPromise) {
				await this._outputEdit(resultMsg, user, startTime, output, "Waiting", EmbedType.Progress);
				try {
					// nothing bad happens if someone hacky created element using specially named class "Promise"
					// it's just waste of time lul
					const r = await output;
					this._outputEdit(resultMsg, user, startTime, r, "Executed", EmbedType.OK);
				} catch(err) {
					this._outputEdit(resultMsg, user, startTime, err, "Executed with error", EmbedType.Warning);
				}
			} else {
				this._outputEdit(resultMsg, user, startTime, output, "Executed", EmbedType.OK);
			}
		} catch(err) {
			this._outputEdit(resultMsg, user, startTime, err, "Fault", EmbedType.Error);
		}
	}

	async _outputEdit(resultMsg: Message, member: GuildMember | User, startTime: number, output: any, text = "Executed", type: EmbedType) {
		const diff = Date.now() - startTime;
		try {
			const outputInsp = this.outputToString(output);

			await resultMsg.edit(undefined, {
				embed: await generateLocalizedEmbed(type, member, {
					custom: true,
					string: "```js\n" + outputInsp + "\n```"
				}, {
					fields: [{
						inline: false,
						name: "Time spent",
						value: `${diff}ms`
					}],
					universalTitle: text
				})
			}, );
		} catch(err) {
			await resultMsg.edit(undefined, {
				embed: await generateLocalizedEmbed(EmbedType.Error, member, {
					custom: true,
					string: "Can't send result, it's longer than 2000 chars"
				}, {
						errorTitle: "There's an error"
					})
			});
			return;
		}
	}

	outputToString(output: any) {
		let depth = 5;
		let outputInsp: string = replaceAll(util.inspect(output, false, depth), "`", "'");
		while(outputInsp.length > 2000 && depth > 0) {
			outputInsp = replaceAll(util.inspect(output, false, --depth), "`", "'");
		}
		if(outputInsp.length > 2000) {
			throw new Error("Large output");
		}
		return outputInsp;
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = EvalJS;