import * as knex from "knex";

let connection: knex;

export function getDB() {
	if(!connection) {
		if(!process.env["DB_PASSWD"]) {
			throw new Error("DB password not set in process environment.");
		}
		connection = knex({
			client: "mysql",
			connection: {
				host: process.env["DB_HOST"] || "127.0.0.1",
				user: process.env["DB_USER"] || "snowballbot",
				password: process.env["DB_PASSWD"],
				database: process.env["DB_NAME"] || "snowbot",
				charset: "utf8mb4"
			}
		});
	}
	return connection;
}

function getTypeInfo(type: string) {
	let t: ITypeInfo = {
		unique: false,
		nullable: false,
		notNullable: false,
		type: "string"
	};

	type = type.replace(/[\!\?\*]/, (s) => {
		if(s === "!") {
			t.unique = true;
		} else if(s === "?") {
			if(t.notNullable) {
				throw new Error("What not nullable cannot be nullable");
			}
			t.nullable = true;
		} else if(s === "*") {
			if(t.nullable) {
				throw new Error("What nullable cannot be not nullable");
			}
			t.notNullable = false;
		}
		return "";
	});

	if(!!(["string", "number"].find(t => type.startsWith(t)))) {
		type = type.replace(/[0-9]{1,}/, (n) => {
			if(t.length !== undefined) {
				throw new Error("Length can be specified once");
			}

			t.length = parseInt(n, 10);

			return "";
		});
	}

	t.type = type;

	return t;
}

export namespace MySQL {
	export type NumbericTypes = "TINYINT"|"SMALLINT"|"MEDIUMINT"|"INT"|"INTEGER"|"BIGINT"|"FLOAT"|"DOUBLE"|"DECIMAL"|"BIT";
	export type DateTimeTypes = "YEAR"|"DATE"|"TIME"|"DATETIME"|"TIMESTAMP";
	export type StringTypes = "CHAR"|"BINARY"|"VARCHAR"|"VARBINARY"|"TINYBLOB"|"TINYTEXT"|"BLOB"|"TEXT"|"MEDIUMBLOB"|"MEDIUMTEXT"|"LONGBLOB"|"LONGTEXT"|"ENUM"|"SET"|"BOOL"|"BOOLEAN";
	export type AdditionalTypes = "JSON";
	export type SpatialTypes = "GEOMETRY"|"POINT"|"LINESTRING"|"POLYGON"|"MULTIPOINT"|"MULTILINESTRING"|"MYLTIPOLYGON"|"GEOMETRYCOLLECTION";

	export type AllTypes = NumbericTypes|DateTimeTypes|StringTypes|AdditionalTypes;
}

interface ITypeInfo {
	unique?: boolean;
	nullable?: boolean;
	notNullable?: boolean;
	type: MySQL.AllTypes|string;
	length?: number;
	default?: string;
	collate?: string;
	comment?: string;
}

export interface ITableSchema {
	[columnName:string]:MySQL.AllTypes|ITypeInfo|string;
}

export async function createTableBySchema(tableName: string, schema:ITableSchema, dropExist = false) {
	if(!schema) {
		throw new Error("There's no scheme!");
	}
	if(!connection) {
		throw new Error("No connection to database!");
	}

	let creationStatus = await connection.schema.hasTable(tableName);
	if(creationStatus && !dropExist) {
		throw new Error("Table is already created!");
	} else if(creationStatus && dropExist) {
		await connection.schema.dropTable(tableName);
	}

	return await connection.schema.createTable(tableName, tb => {
		// let's build!
		for(const key of Object.keys(schema)) {
			const info = schema[key];
			let typeInfo: ITypeInfo;

			if(typeof info === "string") {
				typeInfo = getTypeInfo(info);
			} else if(typeof info === "object") {
				typeInfo = info;
			} else {
				throw new Error(`Invalid information about column`);
			}

			let cb: knex.ColumnBuilder;
			switch(typeInfo.type) {
				case "string": {
					cb = tb.string(key, typeInfo.length);
				} break;
				case "number": {
					cb = tb.integer(key);
				} break;
				case "bignumber": {
					cb = tb.bigInteger(key);
				} break;
				case "boolean": {
					cb = tb.boolean(key);
				} break;
				default: {
					cb = tb.specificType(key, typeInfo.type);
				}
			}

			if(typeInfo.nullable && !typeInfo.notNullable) {
				cb.nullable();
			} else if(typeInfo.notNullable && !typeInfo.nullable) {
				cb.notNullable();
			}
			if(typeInfo.unique) {
				cb.unique();
			}
			if(typeInfo.default) {
				cb.defaultTo(typeInfo.default);
			}
			if(typeInfo.comment) {
				cb.comment(typeInfo.comment);
			}
			if(typeInfo.collate && cb["collate"]) {
				// workaround for wrong typescript defs
				cb["collate"](typeInfo.collate);
			}
		}
	});
}