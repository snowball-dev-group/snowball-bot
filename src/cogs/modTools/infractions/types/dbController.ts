import * as getLogger from "loggy";
import { getDB } from "@utils/db";
import { INullableHashMap } from "../../../../types/Types";
import { IInfraction } from "../infractions";
import * as knex from "knex";
import { EventEmitter } from "events";

let totalCreatedInstances = 0,
	_warned = false;

const CACHE : {
	/**
	 * Cache of latest generated ID per guild
	 */
	recentInfractionId: INullableHashMap<number>
} = { recentInfractionId: Object.create(null) };

const OVERRIDE_PROTECT: Array<keyof(IInfraction)> = ["actorId", "ownerId", "type"];

export class InfractionsDBController extends EventEmitter {
	private readonly _log = getLogger(`${++totalCreatedInstances}`);
	private readonly _tableName: string;
	private _isInitialized = false;
	private _db: knex;

	constructor(tableName: string) {
		super();
		this._tableName = tableName;
	}

	// #region Private

	// #region Checks

	private _checkIsInitialized() {
		if (!this._isInitialized) {
			throw new Error("The database controller is not initialized so can't be used. Please, initializate the controller using init function");
		}
	}

	// #endregion

	// #region Table management

	private async _checkTable() {
		return this._db.schema.hasTable(this._tableName);
	}

	private async _createTable() {
		// realising 'infractions#IInfraction'
		return this._db.schema.createTable(this._tableName, (tb) => {
			tb.bigInteger("guildId").notNullable();
			tb.integer("id").notNullable().unique();
			tb.bigInteger("ownerId").notNullable();
			tb.bigInteger("actorId").notNullable();
			tb.string("infraction", 2000);
			tb.string("type").notNullable();
			tb.boolean("active").notNullable();
			tb.integer("createdAt").notNullable();
			tb.integer("endsAt").nullable();
		});
	}

	private static _applySelectOptions(query: knex.QueryBuilder, options?: ISelectOptions) {
		if (!options) { return query; }

		if (options.limit) {
			if (options.limit < 1 && options.limit !== -1) { throw new Error("Invalid `limit` option value"); }

			query.limit(options.limit);
		}

		if (options.offset) {
			if (options.offset < 1) { throw new Error("Invalid `offset` option value"); }

			query.offset(options.offset);
		}

		if (Array.isArray(options.orderBy)) {
			if (options.orderBy.length < 2) {
				throw new Error("Invalid `orderBy` option value");
			}

			const direction = options.orderBy[1].toLowerCase();

			if (direction !== "desc" && direction !== "asc") {
				throw new Error("Invalid `orderBy` direction");
			}

			query.orderBy(options.orderBy[0], options.orderBy[1]);
		}

		return query;
	}

	private static _applySearchFilter(query: knex.QueryBuilder, filter?: ISearchFilter) {
		if (!filter) { return query; }

		const keys = Object.keys(filter);

		for (let i = 0, l = keys.length; i < l; i++) {
			const key = <keyof(ISearchFilter)> keys[i];

			const val = filter[key];
			if (!val) { continue; }

			if (key === "infraction") {
				let searchQuery = InfractionsDBController._escapeSearchQuery(val[1]);

				switch (val[0]) {
					case "starts":
						searchQuery = `%${searchQuery}`; 
						break;
					case "ends":
						searchQuery = `${searchQuery}%`; 
						break;
					case "includes":
						searchQuery = `%${searchQuery}%`; 
						break;
				}

				query.where(key, "like", searchQuery);

				continue;
			}

			query.where(key, val);
		}

		return query;
	}

	private static _escapeSearchQuery(query: string) {
		return query.replace(/([_$])/, "$1");
	}

	// #endregion
	
	// #endregion

	/**
	 * Creates new infraction in the database
	 * @param infraction Infraction to create
	 * @returns Recent infraction ID
	 */
	public async create(infraction: IInfraction) : Promise<number> {
		this._checkIsInitialized();

		const latestId = await this.getLatestID(infraction.guildId);

		if (latestId && latestId >= infraction.id) {
			throw new Error(`Latest infraction ID is larger or equal to ID of infraction you trying to create`);
		}

		await this._db(this._tableName).insert(infraction);

		this.emit("created", infraction);

		return CACHE.recentInfractionId[infraction.guildId] = infraction.id;
	}

	/**
	 * Gets all active infractions from the database
	 * @param guildId Discord Guild ID
	 * @param invert Should it return inactive infractions or not
	 * @param options Select options (limit, offset, etc)
	 */
	public async getActive(guildId?: string, invert = false, options?: ISelectOptions) : Promise<IInfraction[]> {
		this._checkIsInitialized();

		const query = this._db(this._tableName).select().where("active", !invert);
		if (guildId) { query.where("guildId", guildId); }

		return InfractionsDBController._applySelectOptions(query, options);
	}

	/**
	 * Gets the infractions from the database
	 * @param guildId Discord Guild ID
	 * @param options Select options (limit, offset, etc)
	 */
	public async getInfractions(guildId?: string, options?: ISelectOptions) : Promise<IInfraction[]> {
		this._checkIsInitialized();

		const query = this._db(this._tableName).select();
		if (guildId) { query.where("guildId", guildId); }

		return InfractionsDBController._applySelectOptions(query, options);
	}

	/**
	 * Gets an ID of most recent infraction
	 * @param guildId Discord Guild ID
	 * @param useCache Could it return cached result or not
	 */
	public async getLatestID(guildId: string, useCache = true) : Promise<number | null> {
		if (useCache) {
			const cached = CACHE.recentInfractionId[guildId];
			if (cached) { return cached; }
		}

		const recentInfractions = await this.getInfractions(guildId, {
			limit: 1,
			orderBy: ["id", "desc"]
		});

		if (!recentInfractions) {
			return null;
		}

		return CACHE.recentInfractionId[guildId] = recentInfractions[0].id;
	}

	/**
	 * Searches for the infractions in the database
	 * @param filter Search filter
	 * @param options Select options (limit, offset, etc)
	 */
	public async searchInfractions(filter: ISearchFilter, options?: ISelectOptions) : Promise<IInfraction[]> {
		const query = this._db(this._tableName).select();

		if (!options) { options = { limit: 10 }; } // prevent overload?

		return InfractionsDBController._applySelectOptions(
			InfractionsDBController._applySearchFilter(query, filter),
			options
		);
	}

	/**
	 * Searches for a single infraction in the database
	 * @param filter Search filter
	 */
	public async searchInfraction(filter: ISearchFilter) : Promise<IInfraction | null> {
		const query = this._db(this._tableName).select().first();

		return InfractionsDBController._applySearchFilter(query, filter);
	}

	/**
	 * Updated infraction in database
	 * @param infraction Infraction with valid ID and guildId
	 * @param override Should it allow to override params like `actorId`? By default, `false`
	 */
	public async update(infraction: IInfraction, override = false) : Promise<void> {
		const currentInfraction = await this.searchInfraction({
			guildId: infraction.guildId,
			id: infraction.id
		});

		if (!currentInfraction) {
			throw new Error("Current infraction not found");
		}

		if (!override) {
			for (let i = 0, l = OVERRIDE_PROTECT.length; i < l; i++) {
				const protectKey = OVERRIDE_PROTECT[i];
				if (currentInfraction[protectKey] !== infraction[protectKey]) {
					throw new Error(`You attempted to override "${protectKey}". If you really wish to do so, you must set "override" argument to \`true\``);
				}
			}
		}

		await this._db(this._tableName).where({
			guildId: infraction.guildId,
			id: infraction.id
		}).update(infraction);

		this.emit("updated", infraction);

		if (currentInfraction.ownerId !== infraction.ownerId) {
			this.emit("owner-changed", infraction);
		}
	}

	/**
	 * Initializes the controller
	 */
	public async initialize() {
		if (this._isInitialized) {
			throw new Error("The database controller is already initialized and ready for use.");
		}

		this._db = getDB();

		if (totalCreatedInstances > 1 && !_warned) {
			this._log("warn", "It is recommended to have only one database controller running at the same time. If you reloaded the plugin, you can ignore this warning.");
			_warned = true;
		}

		if (!(await this._checkTable())) {
			this._createTable();
		}

		this._isInitialized = true;

		this.emit("initialized");
	}
}

export interface ISearchFilter {
	guildId?: string;
	id?: number;
	ownerId?: string;
	actorId?: string;
	infraction?: ["starts" | "ends" | "includes", string];
	type?: string;
	active?: boolean;
	createdAt?: string;
	endsAt?: string;
}

export interface ISelectOptions {
	limit?: number;
	offset?: number;
	orderBy?: [string, "desc" | "asc"];
}

export default InfractionsDBController;
