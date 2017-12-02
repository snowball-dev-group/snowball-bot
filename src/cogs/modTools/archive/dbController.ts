import { getDB } from "../../utils/db";
import { getLogger } from "../../utils/utils";
import { Message, MessageAttachment, MessageEmbed } from "discord.js";

const DEFAULT_TABLE_NAME = "messages";
const ERRORS = {
	INIT_NOT_COMPLETE: new Error("Initialization is not complete. Please call `#init` before using controller's functions. This will ensure that database is created and controller is able to manipulate required data"),
	EMPTY_FILTER: new Error("The current passed filter is empty. You must set at lease one property, otherwise results will be always null")
};

let totalInstances = 0;

export class ArchiveDBController {
	private _tableName: string = DEFAULT_TABLE_NAME;
	private _db = getDB();
	private _initComplete = false;
	private _log = getLogger(`ArchiveDBController:${++totalInstances}`);

	constructor(tableName: string = DEFAULT_TABLE_NAME) {
		this._tableName = tableName;
	}

	/**
	 * Checks if required table is created
	 * If not, creates it using default schema
	 */
	async init() {
		const tbStatus = await this._db.schema.hasTable(this._tableName);
		if(!tbStatus) {
			this._log("info", "[init] Table not found, creating started");

			await this._db.schema.createTable(this._tableName, (tb) => {
				tb.string("guildId").nullable().comment("Guild ID");
				tb.string("channelId").notNullable().comment("Channel ID");
				tb.string("messageId").notNullable().comment("Message ID");
				tb.string("authorId").nullable().comment("Author ID");
				tb.string("content", 4000).comment("Content of the message. NULL if there's no content"); // i'm bad at math
				tb.string("other", 10000).comment("JSON with other stuff like attachments and embeds");  // lol
			});

			this._log("info", `[init] Table '${this._tableName.length}' successfully created.`);
		}

		this._initComplete = true;
		this._log("ok", "[init] Initialization complete");
	}

	/**
	 * Inserts IDBMessage into the table
	 * @param msg {IDBMessage} Message to insert into the database
	 */
	async insertMessage(msg: IDBMessage): Promise<IDBMessage> {
		if(!this._initComplete) { throw ERRORS.INIT_NOT_COMPLETE; }
		return await this._db(this._tableName).insert(msg, "*");
	}

	/**
	 * Searches for selected messages by passed filter
	 * @param filter {IDBSearchFilter} The search filter. Must contain at least one selector
	 * @param filter.guildId {string|string[]} Selector by Guild ID(s)
	 * @param filter.userId {string|string[]} Selector by User ID(s)
	 * @param filter.channelId {string|string[]} Selector by Channel ID(s)
	 * @param filter.messageId {string|string[]} Selector by Message ID(s)
	 */
	async search(filter: IDBSearchFilter, limit = 50): Promise<IDBMessage[]> {
		if(!this._initComplete) { throw ERRORS.INIT_NOT_COMPLETE; }
		if(!FILTER_PROPERTIES.find(prop => !isNullOrEmptyArray(filter[prop]))) {
			throw ERRORS.EMPTY_FILTER;
		}
		let req = this._db(this._tableName).select("*");
		if(filter.messageId) {
			req = Array.isArray(filter.messageId) ? req.where("messageId", "in", filter.messageId) : req.where("messageId", filter.messageId);
		}
		if(filter.guildId) {
			req = Array.isArray(filter.guildId) ? req.where("guildId", "in", filter.guildId) : req.where("guildId", filter.guildId);
		}
		if(filter.channelId) {
			req = Array.isArray(filter.channelId) ? req.where("channelId", "in", filter.channelId) : req.where("channelId", filter.channelId);
		}
		if(filter.authorId) {
			req = Array.isArray(filter.authorId) ? req.where("authorId", "in", filter.authorId) : req.where("authorId", filter.authorId);
		}
		req = req.limit(limit).orderBy("messageId", "desc");
		return await req;
	}
}

// ======================
// PUBLIC FUNCTIONS
// ======================

export function convertAttachment(attachment: MessageAttachment) : IEmulatedAttachment {
	return {
		id: attachment.id,
		file: {
			url: attachment.url,
			name: attachment.filename,
			size: attachment.filesize
		}
	};
}

export function convertEmbed(embed: MessageEmbed) : IEmulatedEmbed {
	return {
		author: embed.author && {
			name: embed.author.name,
			url: embed.author.url,
			icon_url: embed.author.iconURL
		},
		title: embed.title,
		description: embed.description,
		fields: embed.fields && embed.fields.length > 0 && embed.fields.map((f) => {
			return {
				inline: f.inline,
				name: f.name,
				value: f.value
			};
		}),
		footer: embed.footer && {
			text: embed.footer.text,
			icon_url: embed.footer.iconURL
		},
		color: embed.color,
		thumbnail: embed.thumbnail && {
			height: embed.thumbnail.height,
			width: embed.thumbnail.width,
			url: embed.thumbnail.url
		},
		image: embed.image && {
			width: embed.image.width,
			height: embed.image.height,
			url: embed.image.url
		},
		video: embed.video && {
			width: embed.video.url,
			height: embed.video.height,
			url: embed.video.url
		},
		url: embed.url,
		provider: embed.provider && {
			name: embed.provider.name,
			url: embed.provider.url
		},
		timestamp: embed.createdTimestamp
	};
}

export function convertToDBMessage(msg: Message): IDBMessage {
	return {
		guildId: msg.guild ? msg.guild.id : undefined,
		channelId: msg.channel.id,
		messageId: msg.id,
		authorId: msg.author ? msg.author.id : msg.system ? "system" : msg.member ? msg.member.id : "unknown",
		content: msg.content,
		other: (msg.attachments.size > 0 || msg.embeds.length > 0) ? JSON.stringify(<IEmulatedContents>{
			attachments: msg.attachments.size > 0 ? msg.attachments.map((a) => convertAttachment(a)) : undefined,
			embeds: msg.embeds.length > 0 ? msg.embeds.filter(e => e.type === "rich").map((e) => convertEmbed(e)) : undefined
		}) : null
	};
}

// ======================
// PRIVATE FUNCTIONS
// ======================

function isNullOrEmptyArray<T>(obj?: T | T[]) {
	return typeof obj === "undefined" || obj === null || (Array.isArray(obj) && obj.length === 0);
}

// ======================
// INTERFACES
// ======================

export interface IDBMessage {
	guildId?: string;
	channelId: string;
	messageId: string;
	authorId: string;
	content: string;
	other?: string | null;
}

export interface IDBSearchFilter {
	guildId?: string | string[];
	authorId?: string | string[];
	channelId?: string | string[];
	messageId?: string | string[];
}

// filter extension
const FILTER_PROPERTIES = (<Array<"guildId" | "authorId" | "channelId" | "messageId">>["guildId", "authorId", "channelId", "messageId"]);

export interface IEmulatedAttachment {
    id: string;
    file: {
        url: string;
        name: string;
        size: number;
    };
}

export interface IEmulatedEmbed {
    author: {
        name: string;
        url: string;
        icon_url: string;
    };
    title: string;
    description: string;
    fields: boolean | Array<{
        inline: boolean;
        name: string;
        value: string;
    }>;
    footer: {
        text: string;
        icon_url: string;
    };
    color: number;
    thumbnail: {
        height: number;
        width: number;
        url: string;
    };
    image: {
        width: number;
        height: number;
        url: string;
    };
    video: {
        width: string;
        height: number;
        url: string;
    };
    url: string;
    provider: {
        name: string;
        url: string;
    };
    timestamp: number;
}

export interface IEmulatedContents {
	attachments: IEmulatedAttachment[];
	embeds: IEmulatedEmbed[];
}
