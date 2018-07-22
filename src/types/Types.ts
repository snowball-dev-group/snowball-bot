import * as knex from "knex";
import * as path from "path";
import * as getLogger from "loggy";
import { fs } from "mz";

// #region Hashmaps

/**
 * Raw Javascript object based hash map.
 * BE AWARE! Use `Object.create(null)` or `createHashMap` form this file to insure you create valid map.
 */
export interface IHashMap<T> {
	[key: string]: T;
}

/**
 * It's shortcut to IHashMap<T|T1|...|undefined|null>.
 * The general use is to be sure, that your script does checks if property is exists in map, before using it.
 * As example this could be used to identify if object from your map was checked (`null`) and not (`undefined`).
 * Imrprovise while checking, never do such thing as `map["prop"] === undefined`
 */
export type INullableHashMap<T> = IHashMap<T | undefined | null>;

export interface ISnowballIPCMessage<T> {
	type: string;
	payload: T;
}

/**
 * Creates empty hashmap or from object (only own properies).
 * The main difference that it uses `Object.create(null)` to create an actual map, it doesn't has a prototype, so your map will not return anything by `toString` or something.
 * @param entries Entries of the hashmap
 */
export function createHashMap<T>(entries?: Array<[string, T]> | IHashMap<T>) : IHashMap<T> {
	const hashMap = Object.create(null);
	if (entries) {
		if (Array.isArray(entries)) {
			for (const entry of entries) {
				if (!Array.isArray(entry)) {
					throw new Error("Invalid entry");
				}
				hashMap[entry[0]] = entry[1];
			}
		} else if (typeof entries === "object") {
			for (const property of Object.getOwnPropertyNames(entries)) {
				hashMap[property] = entries[property];
			}
		} else {
			throw new Error("Unknown type of object");
		}
	}

	return hashMap;
}

// #endregion

// #region Dynamic types

export type Possible<T> = T | undefined | null;
export type IPCMessage<T> = string | ISnowballIPCMessage<T>;

// #endregion

// #region Errors

// I don't sure about the name
// This is just mix of "error" and "code"
export class DetailedError extends Error {
	private readonly _code: string;
	private readonly _subError?: Error;

	public get code() { return this._code; }
	public get subError() { return this._subError; }

	constructor(code: string, message?: string, subError?: Error) {
		super(message);

		this._code = code;
		this._subError = subError;
	}
}

// #endregion

// #region Databases Migrations

const BATCH_SIZE = (() => {
	const pe = process.env["DB_MIGRATION_CHUNK_SIZE"];
	if (pe) { return +pe; }

	return 50; // default chunk size
})();

/**
 * Universal class for database migrations
 */
export abstract class DatabaseMigration<T> {
	private static readonly _log = getLogger("DatabaseMigration");

	/**
	 * [Knex.js](https://knexjs.org/) connection to the required database
	 */
	protected _db: knex;

	/**
	 * Table name, use it to access required table
	 */
	protected _tableName: string;

	constructor(db: knex, tableName: string) {
		this._db = db;
		this._tableName = tableName;
	}

	/**
	 * Checks if migration is required
	 * 
	 * @returns `true` if migration required and `false` if not
	 */
	public abstract isRequired(): Promise<boolean>;

	/**
	 * Runs the migration
	 * 
	 * @returns `true` if migration is complete successfully and `false` if migration failed (may throw an error if critical)
	 */
	public abstract migrate(): Promise<boolean>;

	/**
	 * Processes all the elements of table in chunks.
	 * 
	 * By default size of a single chunk is 50 elements, but this can be modified by environment variable "DB_MIGRATION_CHUNK_SIZE" which gets set only once after requiring file with this class
	 * @param processor Chunk processor
	 */
	protected async _processInChunks(processor: IChunkProcessor<T>) {
		let i = 0;

		while (i !== -1) {
			const select = <T[]> await this._db()
				.select()
				.limit(BATCH_SIZE)
				.offset(i);

			if (!select) { break; }

			const selectLength = select.length;

			if (selectLength === 0) { break; }

			await processor(select, selectLength, () => {
				if (i === -1) {
					throw new Error("Chunk processing is already stopped");
				}

				i = -1;
			});

			if (i !== -1) {
				i += selectLength;
			}
		}
	}

	/**
	 * Run migrations
	 */
	public static async applyMigrations<T>(db: knex, tableName: string, migrationsPath: string) {
		const availableMigrations = (await fs.readdir(
			migrationsPath
		)).sort(); // returns FILENAMES

		for (let i = 0, l = availableMigrations.length; i < l; i++) {
			const migrationPath = path.join(migrationsPath, availableMigrations[i]);
			const migration = <DatabaseMigration<T>> new (require(migrationPath).default)(db, tableName);

			const shortName = path.basename(migrationPath);

			if (!(await migration.isRequired())) {
				DatabaseMigration._log("info", `[${tableName}] Migration "${shortName}" is not required`);

				continue;
			}

			if ((!await migration.migrate())) {
				throw new Error(`Migration "${shortName}" did not complete successfully for table "${tableName}"`);
			}

			DatabaseMigration._log("ok", `[${tableName}] Applied migration ${shortName}`);
		}

		DatabaseMigration._log("ok", `[${tableName}] Migrations complete`);

		return true;
	}
}

interface IChunkProcessor<T> {
	(chunk: T[], chunkSize: number, stop: () => void): Promise<void>;
}

// #endregion
