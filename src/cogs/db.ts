import * as knex from "knex";

let connection:knex;

export default () => {
    if(!connection) {
        if(!process.env["DB_PASSW"]) {
            throw new Error("DB password not set in process environment.");
        }
        connection = knex({
            client: "mysql",
            connection: {
                host: process.env["DB_HOST"] || "127.0.0.1",
                user: process.env["DB_USER"] || "blacksilverbot",
                password: process.env["DB_PASSW"],
                database: process.env["DB_NAME"] || "bsbnew"
            }
        });
    }
    return connection;
};