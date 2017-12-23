import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message } from "discord.js";
import { command } from "../utils/help";
import { getLogger } from "../utils/utils";
import MessagesFlows, { IPublicFlowUnit, IMessageFlowContext } from "../cores/messagesFlows";

const ALLOWED_CMDS = ["ping", "ping_embed"];

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
			return this.flowHandler = flowsMan.watchForMessages((ctx) => this.onMessage(ctx), (ctx) => {
				if(!ctx.parsed) { return false; }
				return ctx.parsed.command ? ALLOWED_CMDS.includes(ctx.parsed.command) : false;
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
		if(!ALLOWED_CMDS.includes(ctx.parsed.command!)) { return; }

		let pongStr = "ℹ Pong!";

		const isEmbed = ctx.parsed.command === "ping_embed",
		startDate = Date.now(),
		msg = <Message>await ctx.message.channel.send(isEmbed ? { embed: { description: "Pong!" } } : "ℹ Pong!"),
		receivedTime = Date.now(),
		ping = Math.max(0, (msg.createdAt.getTime() - startDate)),
		delay = (receivedTime - startDate) - ping, 
		delayStr = delay >= 0 ? `+${delay}` : `${delay}`;

		pongStr = `ℹ Pong - \`${ping}ms\` (\`${delayStr}ms\`)`;

		this.log("info", `Ping for sendMessage#embed to Channel#${msg.channel.id}: ${ping}ms (${delayStr}ms)`);

		return await msg.edit(isEmbed ? { embed: { description: pongStr } } : pongStr);
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
