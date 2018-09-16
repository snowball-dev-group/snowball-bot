import { IModule } from "@sb-types/ModuleLoader/Interfaces";
import { InfractionsDBController, ISelectOptions, ISearchFilter } from "./types/dbController";
import { INullableHashMap } from "../../../types/Types";
import * as getLogger from "loggy";
import { InfractionController, UserIdentify } from "./types/infraction";
import { Guild } from "discord.js";

interface IModuleOptions {
	tableName: string;
}

const DEFAULT_OPTIONS: IModuleOptions = {
	tableName: "infractions"
};

export default class Infractions implements IModule {
	public get signature() { return "snowball.modtools.infractions"; }

	private readonly _controller: InfractionsDBController;
	private readonly _registeredPlugins: INullableHashMap<IInfractionPlugin>;
	private readonly _log = getLogger("Infractions");

	constructor(options?: Partial<IModuleOptions>) {
		const opts = {
			...DEFAULT_OPTIONS,
			...options
		};

		this._controller = new InfractionsDBController(
			opts.tableName
		);
	}

	/**
	 * Registers new handler
	 * @param type Type of infractions
	 * @param handler Handler
	 * @returns Function to unregister handler
	 * @example
	 * const unregisterInfHandler = infractions.registerInfractionHandler("mute", (infraction: IInfraction) => {
	 *  	...
	 * });
	 */
	public registerInfractionHandler(type: string, handler: IInfractionPlugin) {
		if (this._registeredPlugins[type]) {
			throw new Error(`There's already registered handler for type "${type}"`);
		}

		this._registeredPlugins[type] = handler;

		return () => {
			this._registeredPlugins[type] = undefined;
		};
	}

	// #region Infraction controller initializers

	/**
	 * Creates an infraction
	 * @param guild Discord Guild
	 * @param type Type of the infraction (ex. `mute`)
	 * @param infraction Text of the infraction (defaults to "")
	 * @param owner Owner. A person who has the infraction
	 * @param actor Actor. A person who creates t
	 * @param endsAt When infraction ends at
	 * @param createdAt When infraction was created
	 */
	public createInfraction(guild: Guild, type: string, infraction: string, owner?: UserIdentify, actor?: UserIdentify, endsAt?: number, createdAt?: number) {
		return InfractionController.create(
			this._controller,
			guild,
			type,
			infraction,
			owner,
			actor,
			endsAt,
			createdAt
		);
	}

	// #endregion

	// #region DB Controller reflections

	/**
	 * Gets an infraction by it's ID
	 * @param guild Discord Guild
	 * @param id Infraction ID
	 */
	public async getInfraction(guild: Guild, id: number) {
		const inf = await this._controller.searchInfraction({
			guildId: guild.id,
			id: id
		});

		if (inf) {
			return new InfractionController(inf, this._controller, false);
		}

		return null;
	}

	/**
	 * Gets infractions on guild
	 * @param guild Discord Guild
	 * @param options Select options (limit, offset, etc.)
	 */
	public async getInfractions(guild: Guild, options: ISelectOptions) {
		return this._convertInfractionsToControllers(
			await this._controller.getInfractions(guild.id, options)
		);
	}

	/**
	 * Gets active infraction on guild
	 * @param guild Discord Guild
	 * @param invert Should it return inactive infractions instead or not
	 * @param options Select options (limit, offset, etc.)
	 */
	public async getActiveInfractions(guild: Guild, invert = false, options: ISelectOptions) {
		return this._convertInfractionsToControllers(
			await this._controller.getActive(guild.id, invert, options)
		);
	}

	/**
	 * Searches for infractions
	 * @param filter Search filter
	 * @param options Select options (limit, offset, etc.)
	 */
	public async searchInfractions(filter: ISearchFilter, options: ISelectOptions) {
		return this._convertInfractionsToControllers(
			await this._controller.searchInfractions(filter, options)
		);
	}

	/**
	 * Get an ID of latest infraction created on guild
	 * @param guild Discord Guild
	 * @param useCache Could it use cache
	 */
	public async getLatestID(guild: Guild, useCache = true) {
		return this._controller.getLatestID(guild.id, useCache);
	}

	private _createControllerFrom(infraction: IInfraction) {
		return new InfractionController(
			infraction,
			this._controller,
			false
		);
	}

	private _convertInfractionsToControllers(infractions: IInfraction[]) {
		const controllers: InfractionController[] = [];
		for (let i = 0, l = infractions.length; i < l; i++) {
			controllers.push(
				this._createControllerFrom(infractions[i])
			);
		}

		return controllers;
	}

	// #endregion

	private async _handleActiveInfractions() {
		const activeInfractions = await this._controller.getActive();
		
		for (let i = 0, l = activeInfractions.length; i < l; i++) {
			const infraction = activeInfractions[i];

			if (!infraction.active) {
				this._log("warn", `[Handling Active Infractions] Returned inactive infraction "${infraction.guildId}-${infraction.id}"`);
				continue;
			}

			const plugin = this._registeredPlugins[infraction.type];

			if (!plugin) { continue; }

			if (!plugin.handleActiveInfraction) { continue; }

			const controller = new InfractionController(infraction, this._controller);

			plugin.handleActiveInfraction(controller);
		}
	}

	private async _handleOwnerChange(infraction: IInfraction) {
		const type = infraction.type;
		const plugin = this._registeredPlugins[type];

		if (!plugin) {
			this._log("err", `[Handling Owner Change] None plugins registered type "${type}"`);

			return;
		}

		if (!plugin.handleOwnerChange) { return; }

		const controller = new InfractionController(infraction, this._controller);

		plugin.handleOwnerChange(controller);
	}

	/**
	 * Initializated the module
	 */
	public async init() {
		if (!$modLoader.isPendingInitialization(this.signature)) {
			throw new Error("This module doesn't pending initialization");
		}

		this._controller.on(InfractionsEvents.OWNER_CHANGED, (inf: IInfraction) => this._handleOwnerChange(inf));

		await this._controller.initialize();

		await this._handleActiveInfractions();
	}

	/**
	 * Unloads the module
	 */
	public async unload() {
		if (!$modLoader.isPendingUnload(this.signature)) {
			throw new Error("This module doesn't pending loading");
		}

		return true;
	}
}

export const enum InfractionsEvents {
	OWNER_CHANGED = "ownerChanged"
}

export interface IInfractionPlugin {
	handleActiveInfraction?(infraction: InfractionController): void | Promise<void>;
	handleOwnerChange?(infraction: InfractionController): void | Promise<void>;
}

export interface IInfraction {
	guildId: string;
	id: number;
	ownerId: string;
	actorId: string;
	infraction: string;
	type: string;
	active: boolean;
	createdAt: number;
	endsAt: number | null;
}
