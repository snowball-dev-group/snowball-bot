import { Message, User, MessageReaction, ReactionCollector, MessageEmbed, GuildEmoji } from "discord.js";
import { randomNumber } from "@utils/random";

export interface IDecorationOptions {
	title?: string;
	description?: string;
	image?: string;
	thumbnail?: string;
	url?: string;
	author?: {
		iconURL?: string;
		username: string;
	};
	fields?: Array<{
		inline?: boolean;
		name: string;
		value: string;
	}>;
}

export interface IScrollableMessageConfiguration<T> {
	/**
	* Allows to create "Random" button to drop user to random location
	*/
	randomButton?: boolean;
	/**
	* Allows to create "Custom Page" button to drop user to custom location
	*/
	customPageButton?: boolean;
	/**
	* Customize
	*/
	customize?: {
		nextButtonEmoji?: GuildEmoji | string;
		backButtonEmoji?: GuildEmoji | string;
		customPageButtonEmoji?: GuildEmoji | string;
		randomButtonEmoji?: GuildEmoji | string;
		closeButtonEmoji?: GuildEmoji | string;
		homeButtonEmoji?: GuildEmoji | string;
		loadingButtonEmoji?: GuildEmoji | string;
		footerFormat: ((current: number, total: number | undefined, loaded: number) => string);
		messageText?: string;
	};
	/**
	* Decoration function for content
	*/
	decorateFunction: ((content?: T) => Promise<IDecorationOptions>);
	/**
	* Check if user can use actions buttons
	*/
	actionAccessCheck?: ((user: User) => boolean);
	/**
	* Handle "Custom Page" button press, like: ask user to enter number for ex.
	*/
	handleCustomPageRequest?: ((user: User, contentsLength?: number) => Promise<number>);
	/**
	* Time after this message expires
	*/
	expiryTime?: number;
	/**
	* Lazy loading meant for infinite scrolling
	* Return undefined only if there's no content to return
	*/
	lazyLoad?(): Promise<T[] | undefined>;
}

export type ReactionAction = "next" | "back" | "home" | "custom_page" | "random" | "close";

const enum DEFAULT_EMOJIS {
	BACK = "⬆",
	NEXT = "⬇",
	CUSTOM_PAGE = "☝️",
	HOME = "⏫",
	RANDOM_PAGE = "🔀",
	CLOSE = "❌",
	LOADING = "🕓"
}

export class ScrollableMessage<T> {
	constructor(public message: Message, public contents: T[], private readonly configuration: IScrollableMessageConfiguration<T>) { }

	private _currentIndex: number = 0;
	private _controllerInitialized = false;
	private _disposingTimer: NodeJS.Timer;
	private _initComplete = false;

	public get currentPosition() { return this._currentIndex; }

	public async init() {
		if (this._initComplete) { throw new Error("Scrollable message is already initialized"); }
		this._initComplete = true;

		// loading content if there's none
		if (this.contents.length === 0 && this.configuration.lazyLoad) {
			let attempts = 0;
			// trying to load content three times
			while (this.contents.length === 0 && attempts < 3) {
				attempts++;
				try {
					const resz = await this.configuration.lazyLoad();
					if (resz && resz.length !== 0) {
						this.contents = this.contents.concat(resz);
					} else { continue; }
				} catch (err) {
					continue;
				}
			}
		}

		// refreshing to show first page
		await this.refreshMessage();

		// then creating reaction controller
		await this._createReactionController();

		// and handling it
		await this.handleReactions();
	}

	public async dispose() {
		this._controllerInitialized = false;
		this._reactionCollector && this._reactionCollector.stop("dispose");
		this.message.reactions.clear();
		this._disposingTimer && clearTimeout(this._disposingTimer);
	}

	private async _getEmbed(contentIndex: number = 0): Promise<MessageEmbed> {
		let embed = new MessageEmbed();
		if (!this.configuration.lazyLoad) {
			if (this.configuration.customize && this.configuration.customize.footerFormat) {
				embed.setFooter(this.configuration.customize.footerFormat(this._currentIndex + 1, this.contents.length, this.contents.length));
			} else {
				embed.setFooter(`${this._currentIndex + 1} / ${this.contents.length}`);
			}
		} else {
			if (this.configuration.customize && this.configuration.customize.footerFormat) {
				embed.setFooter(this.configuration.customize.footerFormat(this._currentIndex + 1, undefined, this.contents.length));
			} else {
				embed.setFooter(`${this._currentIndex + 1} (${this.contents.length} loaded)`);
			}
		}
		const decorations = await this.configuration.decorateFunction(this.contents[contentIndex]);
		embed = this._customizeEmbedWithDecoration(embed, decorations);

		return embed;
	}

	private _customizeEmbedWithDecoration(embed: MessageEmbed, decoration: IDecorationOptions) {
		decoration.title && embed.setTitle(decoration.title);
		decoration.description && embed.setDescription(decoration.description);
		decoration.thumbnail && embed.setThumbnail(decoration.thumbnail);
		decoration.url && embed.setURL(decoration.url);
		decoration.author && embed.setAuthor(decoration.author.username, decoration.author.iconURL || undefined);
		decoration.image && embed.setImage(decoration.image);
		decoration.fields && decoration.fields.forEach((f) => embed.addField(f.name, f.value.substring(0, 1024), f.inline));

		return embed;
	}

	/**
	* Reacts with emojis
	*/
	private async _createReactionController() {
		await this.message.react((this.configuration.customize && this.configuration.customize.backButtonEmoji) || DEFAULT_EMOJIS.BACK);
		if (this.configuration.customPageButton) {
			await this.message.react((this.configuration.customize && this.configuration.customize.customPageButtonEmoji) || DEFAULT_EMOJIS.CUSTOM_PAGE);
		}
		if (this.configuration.randomButton) {
			await this.message.react((this.configuration.customize && this.configuration.customize.randomButtonEmoji) || DEFAULT_EMOJIS.RANDOM_PAGE);
		}
		await this.message.react((this.configuration.customize && this.configuration.customize.homeButtonEmoji) || DEFAULT_EMOJIS.HOME);
		await this.message.react((this.configuration.customize && this.configuration.customize.nextButtonEmoji) || DEFAULT_EMOJIS.NEXT);
		await this.message.react((this.configuration.customize && this.configuration.customize.closeButtonEmoji) || DEFAULT_EMOJIS.CLOSE);
		this._controllerInitialized = true;
	}

	/**
	 * Checks if reaction is for selected action
	 * @param reaction Reaction
	 * @param action Action
	 */
	private _reactedWith(reaction: MessageReaction, action: ReactionAction): boolean {
		// customs check
		switch (action) {
			case "back": {
				if (this.configuration.customize && this.configuration.customize.backButtonEmoji) {
					return (this.configuration.customize.backButtonEmoji instanceof GuildEmoji && reaction instanceof GuildEmoji && this.configuration.customize.backButtonEmoji.id === reaction.id) || (typeof this.configuration.customize.nextButtonEmoji === "string" && reaction.emoji.name === this.configuration.customize.backButtonEmoji);
				}

				return reaction.emoji.name === DEFAULT_EMOJIS.BACK;
			}
			case "next": {
				if (this.configuration.customize && this.configuration.customize.nextButtonEmoji) {
					return (this.configuration.customize.nextButtonEmoji instanceof GuildEmoji && reaction instanceof GuildEmoji && this.configuration.customize.nextButtonEmoji.id === reaction.id) || (typeof this.configuration.customize.nextButtonEmoji === "string" && reaction.emoji.name === this.configuration.customize.nextButtonEmoji);
				}

				return reaction.emoji.name === DEFAULT_EMOJIS.NEXT;
			}
			case "close": {
				if (this.configuration.customize && this.configuration.customize.closeButtonEmoji) {
					return (this.configuration.customize.closeButtonEmoji instanceof GuildEmoji && reaction instanceof GuildEmoji && this.configuration.customize.closeButtonEmoji.id === reaction.id) || (typeof this.configuration.customize.closeButtonEmoji === "string" && reaction.emoji.name === this.configuration.customize.closeButtonEmoji);
				}

				return reaction.emoji.name === DEFAULT_EMOJIS.CLOSE;
			}
			case "custom_page": {
				if (!this.configuration.customPageButton) { return false; }
				if (this.configuration.customize && this.configuration.customize.customPageButtonEmoji) {
					return (this.configuration.customize.customPageButtonEmoji instanceof GuildEmoji && reaction instanceof GuildEmoji && this.configuration.customize.customPageButtonEmoji.id === reaction.id) || (typeof this.configuration.customize.customPageButtonEmoji === "string" && reaction.emoji.name === this.configuration.customize.customPageButtonEmoji);
				}

				return reaction.emoji.name === DEFAULT_EMOJIS.CUSTOM_PAGE;
			}
			case "random": {
				if (!this.configuration.randomButton) { return false; }
				if (this.configuration.customize && this.configuration.customize.randomButtonEmoji) {
					return (this.configuration.customize.randomButtonEmoji instanceof GuildEmoji && reaction instanceof GuildEmoji && this.configuration.customize.randomButtonEmoji.id === reaction.id) || (typeof this.configuration.customize.randomButtonEmoji === "string" && reaction.emoji.name === this.configuration.customize.randomButtonEmoji);
				}

				return reaction.emoji.name === DEFAULT_EMOJIS.RANDOM_PAGE;
			}
			case "home": {
				if (this.configuration.customize && this.configuration.customize.homeButtonEmoji) {
					return (this.configuration.customize.homeButtonEmoji instanceof GuildEmoji && reaction instanceof GuildEmoji && this.configuration.customize.homeButtonEmoji.id === reaction.id) || (typeof this.configuration.customize.homeButtonEmoji === "string" && reaction.emoji.name === this.configuration.customize.homeButtonEmoji);
				}

				return reaction.emoji.name === DEFAULT_EMOJIS.HOME;
			}
			default: { return false; }
		}
	}

	private findAction(reaction: MessageReaction): ReactionAction | undefined {
		for (const action of ["next", "back", "home", "custom_page", "random", "close"]) {
			if (this._reactedWith(reaction, <ReactionAction> action)) { return <ReactionAction> action; }
		}
	}

	private async trigger(action: ReactionAction, user: User) {
		if (!this._controllerInitialized) {
			return; // if controllers are not initalized, we're not going to do anything
		}
		switch (action) {
			case "back": {
				if (this._currentIndex === 0 || !this.contents[this._currentIndex - 1]) {
					return; // if there's no content in back
				}
				// else changing position & refreshing
				--this._currentIndex;
				await this.refreshMessage();
			} break;
			case "next": {
				if (this._currentIndex === (this.contents.length - 1) && !this.configuration.lazyLoad) {
					return; // if there's no content in next position & it's not lazy mode
				} else if (!this.contents[this._currentIndex + 1] && this.configuration.lazyLoad) {
					// adding loading reaction
					const reaction = await this.message.react((this.configuration.customize && this.configuration.customize.loadingButtonEmoji) || DEFAULT_EMOJIS.LOADING);

					// trying to load content from lazy function
					let newContent: T[] | undefined = undefined;
					try {
						newContent = await this.configuration.lazyLoad();
					} catch (err) {
						newContent = undefined;
					}

					// removing reaction
					this.message.reactions.delete(reaction.emoji.id);

					if (!newContent || newContent.length === 0) {
						return; // if there's no content - returing
					}

					this.contents = this.contents.concat(newContent);
				}
				++this._currentIndex;
				await this.refreshMessage();
			} break;
			case "home": {
				this._currentIndex = 0;
				await this.refreshMessage();
			} break;
			case "close": {
				// just disposing
				await this.dispose();
			} break;
			case "random": {
				this._currentIndex = randomNumber(0, this.contents.length - 1);
				await this.refreshMessage();
			} break;
			case "custom_page": {
				try {
					const newIndex = await this.handleCustomPageReq(user, this.configuration.lazyLoad ? undefined : this.contents.length);
					if (!this.contents[newIndex] && this.configuration.lazyLoad) {
						let newContent: T[] | undefined = undefined;
						while (!newContent && !this.contents[newIndex]) {
							try {
								newContent = await this.configuration.lazyLoad();
								if (!newContent) { break; }
								this.contents = this.contents.concat(newContent);
								if (this.contents[newIndex]) { break; }
							} catch (err) {
								return;
							}
						}
						if (this.contents[newIndex]) {
							this._currentIndex = newIndex;
							await this.refreshMessage();
						}
					}
				} catch (err) {
					return;
				}
			} break;
		}
	}

	private async refreshMessage() {
		// getting embed
		const embed = await this._getEmbed(this._currentIndex);
		// setting content
		await this.message.edit((this.configuration.customize && this.configuration.customize.messageText) || "", embed);

		// updating dispose timer
		if (this._disposingTimer) { clearTimeout(this._disposingTimer); }
		this._disposingTimer = setTimeout(() => this.dispose(), this.configuration.expiryTime || 3600000);
	}

	private async handleCustomPageReq(user: User, contentsLength?: number): Promise<number> {
		if (this.configuration.handleCustomPageRequest) { return this.configuration.handleCustomPageRequest(user, contentsLength); }

		this.message.channel.send("Please, enter the number of page you want to go to");

		const responseMessage = (await this.message.channel.awaitMessages((msg: Message) => {
			return msg.author.id === user.id && !!msg.content && /^[0-9]+\.?[0-9]+?$/.test(msg.content);
		}, {
			time: 60000,
			errors: ["time"],
			max: 1
		})).first()!; // we SHOULD have the message here

		const selectedIndex = parseInt(responseMessage.content, 10);

		if (isNaN(selectedIndex) || selectedIndex < 1 || (contentsLength && selectedIndex < contentsLength)) {
			responseMessage.channel.send("Invalid number, skipping...");
			throw new Error("User entered wrong number");
		}

		return selectedIndex - 1;
	}

	private _triggerWait = false;

	private _reactionCollector: ReactionCollector | undefined = undefined;

	private async handleReactions() {
		// attaching to reactions
		this._reactionCollector = this.message.createReactionCollector(
			(emoji: MessageReaction) => {
				const reactionAuthor = emoji.users.last();

				if (!reactionAuthor) { return false; }

				// checking if triggered by bot
				if (reactionAuthor.id === this.message.client.user.id) { return false; }

				// then checking for permissions
				if (this.configuration.actionAccessCheck && !this.configuration.actionAccessCheck(reactionAuthor)) { return false; }

				// finding action
				return !!this.findAction(emoji);
			}
		);

		this._reactionCollector.on("collect", 
			async (reaction) => {
				const reactionAuthor = reaction.users.last();

				if (!reactionAuthor) { return; }

				// if by some reason it collected bot's reaction - returning
				if (reactionAuthor.id === this.message.client.user.id) { return; }

				// if waiting for controller initialization
				if (!this._controllerInitialized) { return; }

				// removing reaction
				reaction.users.remove(reactionAuthor);

				// checking if we already waiting for a trigger
				if (this._triggerWait) { return; }
				
				// doing appropriate action
				const selectedAction = this.findAction(reaction);
				// if there' no action = ignore
				if (!selectedAction) { return; }

				// setting var
				this._triggerWait = true;

				// triggering
				await this.trigger(selectedAction, reactionAuthor);

				// resetting var
				this._triggerWait = false;
			}
		);
	}
}

export default ScrollableMessage;
