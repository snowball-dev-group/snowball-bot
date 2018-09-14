import { Guild, GuildMember, User } from "discord.js";
import { IInfraction } from "../infractions";
import { InfractionsDBController } from "./dbController";

const SNOWFLAKE_REGEXP = /[0-9]{15,20}/;
const IDS_PLACEHOLDER = "NOT_SET";

/**
 * # Infraction controller
 * 
 * Creates the controller on top of the infraction and allows.
 * 
 * ---
 * 
 * - Use `InfractionController.create` to create new infraction prototype
 * - When you done, use method `push` of newly created controller and it will be pushed to the database
 */
export class InfractionController {
	private readonly _controller: InfractionsDBController;
	private readonly _inf: IInfraction;
	private readonly _isPrototype: boolean;

	constructor(original: IInfraction, dbController: InfractionsDBController, isPrototype = false) {
		this._inf = original;
		this._controller = dbController;
		this._isPrototype = isPrototype;
	}

	// #region Getters

	/**
	 * Is infraction active
	 */
	public get isActive() {
		return this._inf.active;
	}

	/**
	 * Is infraction expired (ended)
	 * 
	 * @example
	 * if (inf.isExpired) { await unmute(inf); }
	 */
	public get isExpired() {
		if (!this._inf.active) {
			return ExpiryStatus.NonExpiring;
		} else if (this._inf.endsAt === null) {
			return ExpiryStatus.Expired;
		} else if (this._inf.endsAt <= Date.now()) {
			return ExpiryStatus.Expired;
		}

		return ExpiryStatus.NotExpired;
	}

	/**
	 * Returns ID of the infraction or -1 if it is a prototype
	 * 
	 * @example
	 * this._log("info", `Created infraction with the ID ${inf.id}`)
	 */
	public get ID() {
		return this._isPrototype ? -1 : this._inf.id;
	}

	/**
	 * Returns timestamp of when the infraction was created
	 * 
	 * @example
	 * str += `Created at ${new Date(inf.createdAt)}`
	 */
	public get createdAt() {
		return this._inf.createdAt;
	}

	/**
	 * Returns timestamp of when the infraction is expires or `undefined` if infraction is inactive
	 * 
	 * @example
	 * str += `Ends at ${new Date(inf.endsAt)}`
	 */
	public get endsAt() {
		return this._inf.active ? this._inf.endsAt : undefined;
	}

	/**
	 * Returns time in milliseconds until expiration of the infraction,
	 * also `null` if already expired and `undefined` if inactive
	 * 
	 * @example
	 * const timeout = inf.untilExpire;
	 * if (timeout) {
	 * ...
	 * }
	 */
	public get untilExpire() {
		if (!this._inf.active || this._inf.endsAt === null) {
			return undefined;
		}

		const untilExpire = this._inf.endsAt - Date.now();

		return untilExpire > 0 ? untilExpire : null;
	}

	/**
	 * Returns infraction type
	 * 
	 * @example
	 * if (inf.type === "mute") {
	 *  ...
	 * }
	 */
	public get type() {
		return this._inf.type;
	}

	/**
	 * Returns infraction text
	 * 
	 * @example
	 * str += `Reason: ${inf.reason}`
	 */
	public get reason() {
		return this._inf.infraction;
	}

	/**
	 * Returns ID of the Discord Guild on which the infraction is persists
	 * 
	 * @example
	 * const guild = $discordBot.guilds.get(inf.guildId);
	 */
	public get guildId() {
		return this._inf.guildId;
	}

	/**
	 * Tries to get Discord Guild using global `$discordBot`
	 * 
	 * @example
	 * inf.guild.member(inf.actor)
	 */
	public get guild() {
		return $discordBot.guilds.get(
			this._inf.guildId
		);
	}

	/**
	 * Returns Actor ID
	 * 
	 * @example
	 * const owner = guild.member(inf.actorId)
	 */
	public get actorId() {
		return this._inf.actorId;
	}

	/**
	 * Returns Actor as member of Guild
	 * 
	 * Uses `this.guild` which uses global `$discordBot`
	 * 
	 * @example
	 * const actor = inf.actorMember;
	 * if (actor) {
	 * 	...
	 * }
	 */
	public get actorMember() {
		const guild = this.guild;

		if (!guild) {
			return undefined;
		}

		return guild.member(
			this._inf.actorId
		);
	}

	/**
	 * Tries to get Actor as User using global `$discordBot`
	 * 
	 * @example
	 * const actor = inf.actorUser;
	 * if (actor) {
	 * 	...
	 * }
	 */
	public get actorUser() {
		return $discordBot.users.get(
			this._inf.actorId
		);
	}

	/**
	 * Returns Owner ID
	 * 
	 * @example
	 * const owner = guild.member(inf.ownerId)
	 */
	public get ownerId() {
		return this._inf.ownerId;
	}

	/**
	 * Returns Owner as member of Guild
	 * 
	 * Uses `this.guild` which uses global `$discordBot`
	 * 
	 * @example
	 * const owner = inf.ownerMember;
	 * if (owner) {
	 * 	...
	 * }
	 */
	public get ownerMember() {
		const guild = this.guild;

		if (!guild) {
			return undefined;
		}

		return guild.member(
			this._inf.ownerId
		);
	}

	/**
	 * Tries to get Owner as User using global `$discordBot`
	 * 
	 * @example
	 * const owner = inf.ownerUser;
	 * if (owner) {
	 * 	...
	 * }
	 */
	public get ownerUser() {
		return $discordBot.users.get(
			this._inf.ownerId
		);
	}

	// #endregion

	/**
	 * Marks infraction as inactive and removes `endsAt`
	 */
	public async markInactive() : Promise<this> {
		if (!this._inf.active) { return this; }

		const renewedInfraction : IInfraction = {
			...this._inf,
			active: false,
			endsAt: null
		};

		if (!this._isPrototype) {
			await this._controller.update(renewedInfraction);
		}

		this._inf.active = false;
		this._inf.endsAt = null;

		return this;
	}

	/**
	 * Marks infraction as active and sets `endsAt`
	 * @param endsAt When infraction ends (timestamp)
	 */
	public async markActive(endsAt: number) : Promise<this> {
		if (endsAt < Date.now()) {
			throw new Error("Invalid `endsAt` argument specified. Could not mark infraction as active until the past time");
		}

		const renewedInfraction : IInfraction = {
			...this._inf,
			active: true,
			endsAt
		};

		if (!this._isPrototype) {
			await this._controller.update(renewedInfraction);
		}

		this._inf.active = true;
		this._inf.endsAt = endsAt;

		return this;
	}

	/**
	 * Updates reason of the infraction
	 * @param reason Reason of why infraction was given to user
	 */
	public async setReason(reason: string) : Promise<this> {
		const renewedInfraction : IInfraction = {
			...this._inf,
			infraction: reason
		};

		if (!this._isPrototype) {
			await this._controller.update(renewedInfraction);
		}

		this._inf.infraction = reason;

		return this;
	}

	/**
	 * Sets the type of the infraction
	 * 
	 * This method only could be used on prototype infractions
	 * @param type Infraction type
	 */
	public setType(type: string) : this {
		if (!this._isPrototype) {
			throw new Error("This method only could be used on prototype infractions");
		}

		this._inf.type = type;

		return this;
	}

	/**
	 * Sets guild on which the infraction is persists
	 * 
	 * This method only could be used on prototype infractions
	 * @param guild Discord Guild
	 */
	public setGuild(guild: Guild) : this {
		if (!this._isPrototype) {
			throw new Error("This method only could be used on prototype infractions");
		}

		this._inf.guildId = guild.id;

		return this;
	}

	/**
	 * Sets the actor of the infraction
	 * 
	 * Throws error if the infraction is already created in the database and `override` is not present
	 * @param actor Actor. The person who gives the infraction
	 */
	public async setActor(actor: UserIdentify, override = false) : Promise<this> {
		if (!this._isPrototype && !override) {
			throw new Error("You must set `override` to `true` in order to update existing infraction");
		}

		const renewedInfraction: IInfraction = {
			...this._inf,
			actorId: actor.id
		};

		if (!this._isPrototype) {
			await this._controller.update(renewedInfraction, override);
		}

		this._inf.actorId = actor.id;

		return this;
	}

	/**
	 * Sets the owner of the infraction
	 * 
	 * ---
	 * **THIS IS DANGEROUS THING TO DO WITH THE CREATED INFRACTIONS IN THE DATABASE**:
	 * 
	 * `Infractions` should call `handleOwnerChange`, but if plugin has no handler for this case,
	 * it may lead to some bad things, that can partially or completely break plugin and result of
	 * performing actions mistakenly.
	 * @param owner Owner. The person who receives the infraction
	 */
	public async setOwner(owner: UserIdentify, override = false) {
		if (!this._isPrototype && !override) {
			throw new Error("You must set `override` to `true` in order to update existing infraction.");
		}

		const renewedInfraction: IInfraction = {
			...this._inf,
			ownerId: owner.id
		};

		if (!this._isPrototype) {
			await this._controller.update(renewedInfraction, override);
		}

		this._inf.ownerId = owner.id;

		return this;
	}

	/**
	 * Creates the infraction in the database
	 */
	public async push() : Promise<this> {
		if (!this._isPrototype) {
			throw new Error("This method only could be used on prototype infractions");
		}

		if (!SNOWFLAKE_REGEXP.test(this._inf.ownerId)) {
			if (this._inf.ownerId === IDS_PLACEHOLDER) {
				throw new Error("Owner ID is not set");
			}
			throw new Error("Owner ID is invalid");
		}

		if (!SNOWFLAKE_REGEXP.test(this._inf.actorId)) {
			if (this._inf.actorId === IDS_PLACEHOLDER) {
				throw new Error("Actor ID is not set");
			}
			throw new Error("Owner ID is invalid");
		}

		if (!this._inf.infraction) {
			throw new Error("The infraction text is empty");
		}

		this._inf.id = (await this._controller.getLatestID(this._inf.guildId)) || 1;

		await this._controller.create(this._inf);

		return this;
	}

	/**
	 * Creates new infraction prototype
	 * @param dbController DB controller which will be used to perform update operations
	 * @param guild The guild that the infraction belongs where
	 * @param type Type of the infraction (example - `mute`)
	 * @param infraction Reason why infraction is given
	 * @param owner Owner. A person for who infraction is created
	 * @param actor Actor. A person who made an infraction
	 * @param endsAt Timestamp of when infraction ends (marks infraction active)
	 * @param createdAt Timestamp of when infraction is created (by default uses current timestamp)
	 */
	public static create(dbController: InfractionsDBController, guild: Guild, type: string, infraction: string = "", owner?: UserIdentify, actor?: UserIdentify, endsAt?: number, createdAt?: number) : InfractionController {
		let isActive = false;

		if (endsAt != null) {
			if (endsAt <= Date.now()) {
				throw new Error("Invalid `endsAt` argument specified. Could not mark infraction as active until the past time");
			}
			isActive = true;
		}

		return new InfractionController({
			id: -1,
			guildId: guild.id,
			ownerId: owner ? owner.id : IDS_PLACEHOLDER,
			actorId: actor ? actor.id : IDS_PLACEHOLDER,
			infraction,
			type,
			active: isActive,
			endsAt: isActive ? endsAt! : null,
			createdAt: createdAt != null ? createdAt : Date.now()
		}, dbController, true);
	}
}

export type UserIdentify = GuildMember | User;

export enum ExpiryStatus {
	/**
	 * The infraction cannot expire because it is inactive
	 */
	NonExpiring = 2,
	/**
	 * The infraction is not yet expired and active
	 */
	NotExpired = 4,
	/**
	 * The infraction is expired and no longer active
	 */
	Expired = 6
}

export default InfractionController;
