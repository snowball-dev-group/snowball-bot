import { IPublicFlowUnit, IMessageFlowContext, default as MessagesFlows } from "../cores/messagesFlows";
import { IModule } from "../../types/ModuleLoader";
import { Plugin } from "../plugin";
import { Message, GuildMember, User } from "discord.js";
import * as Random from "random-js";
import * as getLogger from "loggy";
import { EmbedType, sleep } from "../utils/utils";
import { command } from "../utils/help";
import { generateLocalizedEmbed, localizeForUser } from "../utils/ez-i18n";
import { IHashMap } from "../../types/Types";

const ICONS = {
	THINKING: "https://i.imgur.com/hIuSpIl.png",
	RESPONSE: "https://twemoji.maxcdn.com/72x72/1f3b1.png"
};

interface I8BallResponsesCategory {
	color: number;
	variants: string[];
}

@command("FUN", "8ball", "loc:8BALL_META_DEFAULT", {
	"loc:8BALL_META_DEFAULT_ARG0": {
		optional: false,
		description: "loc:8BALL_META_DEFAULT_ARG0_DESC"
	}
})
class Ball8 extends Plugin implements IModule {
	public get signature() {
		return "snowball.features.8ball";
	}

	log = getLogger("8Ball");
	responses: IHashMap<I8BallResponsesCategory> = {
		"affirmative": {
			color: 0x2196F3,
			variants: [
				"8BALL_ANSWER_CERTAIN", "8BALL_ANSWER_DECIDEDLY", "8BALL_ANSWER_WODOUBT",
				"8BALL_ANSWER_DEFINITELY", "8BALL_ANSWER_RELY"
			]
		},
		"non-committal": {
			color: 0x4CAF50,
			variants: [
				"8BALL_ANSWER_NC_PROB", "8BALL_ANSWER_NC_MOSTLIKELY", "8BALL_ANSWER_NC_OUTLOOK",
				"8BALL_ANSWER_NC_SIGNS", "8BALL_ANSWER_NC_YES"
			]
		},
		"neutral": {
			color: 0xFFC107,
			variants: [
				"8BALL_ANSWER_NEUTRAL_HAZY", "8BALL_ANSWER_NEUTRAL_LATER", "8BALL_ANSWER_NEUTRAL_NOT",
				"8BALL_ANSWER_NEUTRAL_CANTPREDICT", "8BALL_ANSWER_NEUTRAL_CONCENTRATE"
			]
		},
		"negative": {
			color: 0xe53935,
			variants: [
				"8BALL_ANSWER_NEGATIVE_DONT", "8BALL_ANSWER_NEGATIVE_MYREPLY", "8BALL_ANSWER_NEGATIVE_SOURCES",
				"8BALL_ANSWER_NEGATIVE_OUTLOOK", "8BALL_ANSWER_NEGATIVE_DOUBTFUL"
			]
		}
	};
	categories = Object.keys(this.responses);
	flowHandler: IPublicFlowUnit;

	constructor() {
		super({}, true);
		this.log("ok", "8Ball is loaded");
	}

	async init() {
		const messagesFlowsKeeper = $snowball.modLoader.findKeeper<MessagesFlows>("snowball.core_features.messageflows");
		if(!messagesFlowsKeeper) { throw new Error("`MessageFlows` not found!"); }

		messagesFlowsKeeper.onInit((flowsMan: MessagesFlows) => {
			return this.flowHandler = flowsMan.watchForMessages((ctx) => this.onMessage(ctx), "8ball", {
				timeoutHandler: 10000
			});
		});
	}

	private async onMessage(ctx: IMessageFlowContext) {
		const msg = ctx.message;
		const i18nTarget = msg.member || msg.author;
		const actualUser = i18nTarget instanceof GuildMember ? i18nTarget.user : i18nTarget;

		const random = new Random(Random.engines.mt19937().autoSeed());

		const localName = await localizeForUser(i18nTarget, "8BALL_NAME");

		let message: Message;
		try {
			message = (await msg.channel.send("", {
				embed: await generateLocalizedEmbed(EmbedType.Empty, i18nTarget, "8BALL_THINKING", {
					author: {
						name: localName,
						icon_url: ICONS.THINKING
					},
					clearFooter: true
				})
			})) as Message;
		} catch(err) {
			this.log("err", "Damn! 8Ball can't send message", err);
			$snowball.captureException(err, {
				extra: { channelId: msg.channel.id }
			});
			return;
		}

		await sleep(random.integer(1500, 3000));

		const categoryName = random.pick<string>(this.categories);
		const category = this.responses[categoryName];

		const answer = random.pick<string>(category.variants);

		try {
			await message.edit("", {
				embed: await generateLocalizedEmbed(EmbedType.Empty, i18nTarget, answer, {
					author: {
						icon_url: ICONS.RESPONSE,
						name: localName
					},
					color: category.color,
					footer: {
						text: await localizeForUser(i18nTarget, "8BALL_INREPLY", {
							username: i18nTarget instanceof GuildMember ? i18nTarget.displayName : (i18nTarget as User).username
						}),
						icon_url: actualUser.displayAvatarURL({ format: "webp", size: 128 })
					}
				})
			});
		} catch(err) {
			$snowball.captureException(err, { extra: { id: message.id } });
			this.log("err", "Bummer! We can't update message, trying to delete our message", err);
			try {
				await message.delete();
			} catch(err) {
				this.log("err", "Message also can't be removed...", err);
				$snowball.captureException(err, { extra: { id: message.id } });
			}
		}
	}

	async unload() {
		this.unhandleEvents();
		return true;
	}
}

module.exports = Ball8;
