import * as knex from "knex";

let connection:knex;

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
                database: process.env["DB_NAME"] || "snowbot"
            }
        });
    }
    return connection;
};

interface TypeInfo {
    unique:boolean;
    nullable:boolean;
    notNullable:boolean;
    type:string;
    length:number|undefined;
    default:string|undefined;
}

function getTypeInfo(type:string) {
    let t:TypeInfo = {
        unique: false,
        nullable: false,
        notNullable: false,
        type: "string",
        length: undefined,
        default: undefined
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

    type = type.replace(/[0-9]{1,}/, (n) => {
        if(t.length !== undefined) {
            throw new Error('Length can be specified once');
        }

        t.length = parseInt(n, 10);

        return "";
    });

    if(["string", "number", "boolean"].indexOf(type) === -1) {
        throw new Error(`Invalid type '${type}'`)
    }

    t.type = type;

    return t;
}

export async function createTableBySchema(tableName:string, schema:any, dropExist = false) {
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
        let keys = Object.keys(schema);
        keys.forEach(key => {
            let info = schema[key];
            let typeInfo:TypeInfo;

            if(typeof info === "string") {
                typeInfo = getTypeInfo(info);
            } else if(typeof info === "object") {
                typeInfo = info;
            } else {
                throw new Error(`Invalid information about column`);
            }

            let cb:knex.ColumnBuilder;
            switch(typeInfo.type) {
                case "string": {
                    cb = tb.string(key, typeInfo.length);
                } break;
                case "number": {
                    cb = tb.integer(key);
                } break;
                case "boolean": {
                    cb = tb.boolean(key);
                } break;
                default: {
                    throw new Error(`Unsupported type: '${typeInfo.type}'`);
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
        });
    });
}