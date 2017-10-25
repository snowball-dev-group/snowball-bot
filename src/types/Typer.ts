/**
 * Schema for object, contains all parametrs that Typer should check
 */
export interface ISchemaObject {
    /**
     * Is element optional and could be undefined?
     */
    optional?: boolean;
    /**
     * Type of object (`typeof`/`any`)
     * Use `any` to skip all type checks
     */
    type: string;
    /**
     * `true` if object by this property is an array
     * Will be auto-determinated based on `instanceOf` (if present)
     */
    isArray?: boolean;
    /**
     * `true` if object by this property is a object
     * Will be automatically set to `true` if `isArray` = `true`
     */
    isObject?: boolean;
    /**
     * `true` if object by this property is a number
     * Will be automatically set to `false` if `isArray` = `true` or `isObject` = `true`
     */
    isNumber?: boolean;
    /**
     * Additional `instanceof` check
     */
    instanceOf?: any;
    /**
     * If `isNumber` is set to `true`, then checks if number is NaN
     */
    notNaN?: boolean;
    /**
     * If `isObject` is set to `true`, then checks if property contains valid object
     */
    schema?: ISchema;
    /**
     * If `isArray` is set to `true`, then checks if every element in array matches schema
     */
    elementSchema?: ISchemaObject;
    /**
     * If `type` is set to `string`, checks if `regexp` test not fails
     */
    regexp?: RegExp;
}

/**
 * Recursive schema, hashmap-like
 */
export interface ISchema {
    [property: string]: ISchemaObject;
}

/**
 * Details about what Typer disliked in your value
 */
export interface ITypeErrorInvalidInfo {
    expectedInstance?: any;
    actualInstance?: any;
    expectedType?: string;
    actualType?: string;
    optional?: boolean;
    isNotObject?: boolean;
    isNotArray?: boolean;
    isNaN?: boolean;
    isRegExpFailed?: boolean;
    schemaRef: ISchemaObject;
}

/**
 * Class of TyperError: Error that Typer throws once one of tests fails
 */
export class TyperError extends Error {
    /**
     * Prefix for Typer errors
     */
    static ERROR_PREFIX = "Typer check failed:";

    constructor(message: string, public readonly path: string, public readonly invalidInfo: ITypeErrorInvalidInfo) {
        super(`${TyperError.ERROR_PREFIX} ${message}`);
    }
}

/**
 * Typer is a special class to check random values
 * It's recommended for user-input data, like configs
 */
export class Typer {
    /**
     * Checks if `obj` is undefined or null
     */
    static isUndefined(obj: any): obj is undefined | null {
        return typeof obj === "undefined" || obj === null;
    }

    /**
     * Alias to `Array.isArray`
     * @deprecated Use `Array.isArray` instead
     */
    static isArray(obj: any): obj is any[] {
        return Array.isArray(obj);
    }

    /**
     * Checks if passed `obj` is Object
     * Alias to `typeof obj === "object"`
     */
    static isObject(obj: any): obj is object {
        return typeof obj === "object";
    }

    /**
     * Checks selected value by schema
     * Throws TyperError if value contains Errors
     * @param schema Schema
     * @param val Value
     * @param path Path of object
     */
    static checkValueBySchema(schema: ISchemaObject, val: any, path: string) {
        // preparing
        if(Typer.isUndefined(schema.optional)) {
            schema.optional = false;
        }

        if(schema.type !== "any") {
            if(Typer.isUndefined(val)) {
                if(!schema.optional) {
                    // -> Not optional, throw
                    throw new TyperError("Value not provided, when required by schema", path, {
                        optional: false,
                        schemaRef: schema
                    });
                } else {
                    // -> Optional, skipping futher checks
                    return;
                }
            }

            let valType = typeof val;

            if(valType !== schema.type) {
                throw new TyperError("Invalid type of object", path, {
                    expectedType: schema.type,
                    actualType: valType,
                    schemaRef: schema
                });
            }

            // => Arrays
            if(Typer.isUndefined(schema.isArray)) {
                if(!Typer.isUndefined(schema.instanceOf) && schema.instanceOf === Array) {
                    schema.isArray = true;
                }
            }

            // => => `isArray`: `isObject` auto-set
            if(schema.isArray) {
                schema.isObject = true;
            }

            // => Objects
            if(Typer.isUndefined(schema.isObject)) {
                if(!Typer.isUndefined(schema.instanceOf) && schema.instanceOf === Object) {
                    schema.isObject = true;
                } else {
                    schema.isObject = schema.type === "object";
                }
            }

            // => => `isObject`: `isNumber` auto-set
            if(schema.isObject) {
                schema.isNumber = false;
            }

            // => => Checking if `isObject` but `val` is not Object
            if(schema.isObject && !Typer.isObject(val)) {
                throw new TyperError("Value is not object, when required to be by schema", path, {
                    isNotObject: true,
                    schemaRef: schema
                });
            }

            // => => Checking if `isArray` but `val` is not Array
            if(schema.isArray && !Array.isArray(val)) {
                throw new TyperError("Value is not array, when required to be by schema", path, {
                    isNotArray: true,
                    schemaRef: schema
                });
            }

            // => => Checking if `instanceOf` but `val` is not `instanceof schemaInfo.instanceOf`
            if(!!schema.instanceOf && !(val instanceof schema.instanceOf)) {
                throw new TyperError("Invalid instance of object", path, {
                    expectedInstance: schema.instanceOf,
                    actualInstance: val.constructor,
                    schemaRef: schema
                });
            }

            // => => Checking if `val` is not NaN (if it's number ofc)
            if(valType === "number" && schema.notNaN && isNaN(val)) {
                throw new TyperError("Value is NaN when required to be number by schema", path, {
                    isNaN: true,
                    schemaRef: schema
                });
            }

            // => => Checking if `val` is fails at `regexp` test
            if(valType === "string" && schema.regexp && !schema.regexp.test(val)) {
                throw new TyperError("Value failed at RegExp test", path, {
                    isRegExpFailed: true,
                    schemaRef: schema
                });
            }

            // => => Checking if `isArray && schemaInfo.elementSchema` but `obj[*]` is not matches `schemaInfo.elementSchema`
            if(schema.isArray && schema.elementSchema) {
                for(let o in val) {
                    Typer.checkValueBySchema(schema.elementSchema, val[o], `${path}[${o}]`);
                }
            } else if(schema.isObject && schema.schema) {
                Typer.checkObjectBySchema(schema.schema, val, `${path}`);
            }
        }
    }

    static checkObjectBySchema(schema: ISchema, obj: object, deepPath: string = "obj") {
        for(let property in schema) {
            let propSchema = schema[property];
            Typer.checkValueBySchema(propSchema, obj[property], `${deepPath}.${property}`);
        }
    }
}