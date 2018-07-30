import { Guild } from "discord.js";
import { getDB, createTableBySchema } from "@cogs/utils/db";
import { DatabaseMigration } from "@sb-types/Types";
import * as shortid from "shortid";
import * as getLogger from "loggy";
import * as path from "path";

// Guilds Database Controller

const TABLE_SCHEMA = {
	// unique guild id
	"gid": "string",
	// discord guild snowflake
	"guildId": "string",
	// guild role id
	"roleId": "string",
	// owner discord id
	"ownerId": "string",
	// guild name
	"name": "string",
	// description
	"description": "string",
	// guild styles
	"customize": {
		type: "TEXT"
	}
};

const MIGRATIONS_FOLDER = 
	process.env["SB_GUILDS_MIGRATIONS_DIR"] ||
	path.join(
		__dirname,
		"dbMigrations"
	);

let instances = 0;

export class GuildsDBController {
	private readonly _tableName: string;
	private readonly _log = getLogger(`GuildDBController:${instances++}`);
	private readonly _db = getDB();

	constructor(tableName: string) {
		this._tableName = tableName;
	}

	public async init() {
		const hasTable = await this._db.schema.hasTable(this._tableName);

		if (!hasTable) {
			this._log("info", "Create the database...");

			await createTableBySchema(this._tableName, TABLE_SCHEMA);
		}

		await DatabaseMigration.applyMigrations<IGuildRow>(
			this._db,
			this._tableName,
			MIGRATIONS_FOLDER
		);
	}

	public async getGuild(guild: Guild, name: string) {
		return this._db(this._tableName)
			.where({
				guildId: guild.id,
				name
			})
			.first();
	}

	public async getGuilds(guild: Guild, offset = 0, limit = 10) {
		const rows = await this._db(this._tableName)
			.select()
			.where({
				guildId: guild.id
			})
			.offset(offset)
			.limit(limit);

		// TODO: see if something wrong here:
		return {
			offset: offset,
			nextOffset: offset + limit,
			rows: <IGuildRow[]> rows
		};
	}

	public async createGuild(guild: Guild, name: string, ownerId: string, roleId: string) : Promise<void> {
		if (!guild.roles.has(roleId)) {
			throw new Error("Role for guild not found");
		}

		const row: IGuildRow = {
			guildId: guild.id,
			name: name,
			description: "",
			ownerId,
			roleId,
			customize: "{}",
			gid: `${GuildsDBController.createGID()}`
		};

		return this._db(this._tableName)
			.insert(row);
	}

	public async updateGuild(guild: IGuildRow) : Promise<void> {
		return this._db(this._tableName)
			.where(
				GuildsDBController._getUniqueSelector(
					guild
				)
			)
			.update(guild);
	}

	public async deleteGuild(guild: IGuildRow) {
		return this._db(this._tableName)
			.where(
				GuildsDBController._getUniqueSelector(
					guild
				)
			)
			.delete();
	}

	private static _getUniqueSelector(guild: IGuildRow) {
		return {
			// list all the unahchangable things
			guildId: guild.guildId,
			roleId: guild.roleId,
			gid: guild.gid
		};
	}

	public static createGID() {
		return `${shortid()}:${shortid()}`;
	}
}

export type UnchangeableGuildProperies = {
	/**
	 * Discord Guild SNOWFLAKE
	 */
	readonly guildId: string;
	/**
	 * Discord Role SNOWFLAKE
	 */
	readonly roleId: string;
	/**
	 * Unique Guild ID
	 */
	readonly gid: string;
};

export interface IGuildRow extends UnchangeableGuildProperies {
	/**
	 * Name of Guild
	 */
	name: string;
	/**
	 * Description of guild
	 */
	description: string;
	/**
	 * Customize JSON
	 */
	customize: string | any;
	/**
	 * Owner ID
	 */
	ownerId: string;
}

export interface IGuildCustomize {
	/**
	 * Guild admins who can control it
	 */
	admins: string[];
	/**
	 * Is this guild private?
	 */
	invite_only?: boolean;
	/**
	 * Google Analystic key
	*/
	ua?: string;
	/**
	 * Welcome message
	 */
	welcome_msg?: string;
	/**
	 * Channel for welcome message
	 */
	welcome_msg_channel?: string;
	/**
	 * Guild invites
	 * (for private guilds)
	 */
	invites?: string[];
	/**
	 * Big image in information block
	 */
	image_url?: string;
	/**
	 * Icon URL
	 */
	icon_url?: string;
	/**
	 * Guild rules
	 */
	rules?: string;
	/**
	 * Banned users
	 */
	banned?: string[];
}
