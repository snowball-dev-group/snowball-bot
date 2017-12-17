import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message } from "discord.js";
import { command } from "../utils/help";
import { getLogger } from "../utils/utils";
import MessagesFlows, { IPublicFlowUnit, IMessageFlowContext } from "../cores/messagesFlows";

@command("UTILITES", "ping", "loc:PING_CMDMETA_DEFAULT_DESCRIPTION")
@command("UTILITES", "ping_embed", "loc:PING_CMDMETA_EMBED_DESCRIPTION")
class Ping extends Plugin implements IModule {
	public get signature() {
		return "snowball.core_features.ping";
	}

	private log = getLogger("PingJS");
	private flowHandler: IPublicFlowUnit;

	constructor() {
		super({});
	}

	public async init() {
		this.log("info", "Searching for `MessagesFlows` core keeper");

		const messagesFlowsKeeper = $snowball.modLoader.signaturesRegistry["snowball.core_features.messageflows"];

		if(!messagesFlowsKeeper) {
			throw new Error("`MessageFlows` not found");
		}

		const initHandler = (flowsMan: MessagesFlows) => {
			return flowsMan.watchForMessages((ctx) => this.onMessage(ctx), (ctx) => {
				if(!ctx.parsed) { return false; }
				return ctx.parsed.command ? ["ping", "ping_embed"].includes(ctx.parsed.command) : false;
			});
		};

		if(messagesFlowsKeeper.base) {
			initHandler(messagesFlowsKeeper.base);
		} else {
			messagesFlowsKeeper.once("initialized", (base: MessagesFlows) => initHandler(base));
		}
	}

	async onMessage(ctx: IMessageFlowContext) {
		if(!ctx.parsed) { return; }
		let msg = ctx.message;
		if(ctx.parsed.command === "ping" && !ctx.parsed.args) {
			await msg.react("🏃");
			let startDate = Date.now();
			msg = await msg.channel.send(":information_source: Pong!") as Message;
			let diff = Date.now() - startDate;
			this.log("info", `Ping for sendMessage to Channel#${msg.channel.id}: ${diff}ms`);
			msg.edit(`:information_source: Pong - \`${diff}ms\`!`);
		} else if(ctx.parsed.command === "ping_embed" && !ctx.parsed.args) {
			await msg.react("🏃");
			let startDate = Date.now();
			msg = await msg.channel.send("", {
				embed: {
					description: "Pong!"
				}
			}) as Message;
			let diff = Date.now() - startDate;
			this.log("info", `Ping for sendMessage#embed to Channel#${msg.channel.id}: ${diff}ms`);
			msg.edit(``, {
				embed: {
					description: `:information_source: Pong - \`${diff}ms\`!`
				}
			});
		} else {
			this.log("warn_trace", "Called with unknown command!?");
		}
	}

	async unload() {
		if(this.flowHandler) {
			this.flowHandler.unhandle();
		}
		this.unhandleEvents();
		return true;
	}
}

module.exports = Ping;
