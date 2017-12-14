import { randomString } from "../utils/random";
import { getLogger, sleep } from "../utils/utils";
import { setTimeout } from "timers";
import PrefixAll from "./prefixAll/prefixAll";
import { IModule, ModuleBase, ModuleLoadState } from "../../types/ModuleLoader";
import { Message } from "discord.js";
import { ISimpleCmdParseResult, simpleCmdParse } from "../utils/text";

export const MESSAGEFLOWS_SIGNATURE = "snowball.core.cmd_handler";
export const HANDLER_TIMEOUT = 5000;
export const CHECK_TIMEOUT = 3000;
export const HANDLER_MAXTIMEOUT = 120000; // 2 mins for handler? yay
export const CHECK_MAXTIMEOUT = 60000; // 1 min for checker
// still could be disabled via -1

export default class MessagesFlows implements IModule {
	public get signature() {
		return MESSAGEFLOWS_SIGNATURE;
	}

	private _flowUnits: IFlowUnit[];

	// kinda flow optimizations
	private _anyWith = {
		prefixCheck: false,
		defaultParsing: false
	};

	// default timings
	private _timings = {
		timeoutHandler: HANDLER_TIMEOUT,
		timeoutCheck: CHECK_TIMEOUT,
		maxTimeoutHandler: HANDLER_MAXTIMEOUT,
		maxTimeoutCheck: CHECK_MAXTIMEOUT
	};

	// message handler?
	private _messageHandler: ((msg: Message) => any);

	// prefixal' instance
	private prefixAllKeeper?: ModuleBase<PrefixAll>;

	private log = getLogger("CommandsHandler");

	constructor() {
		this._messageHandler = ((msg: Message) => this._startOnMessageFlow(msg));
		$discordBot.on("message", this._messageHandler);
	}

	public async init() {
		const prefixAllKeeper = $snowball.modLoader.signaturesRegistry["snowball.core_features.prefixall"];
		
		if(!prefixAllKeeper) {
			this.log("warn", "[crit] We haven't found `PrefixAll` keeper, means we could not check prefix. Some checks may fail if they depend on this module. Checks that use their own prefix verifier should work fine.");
		} else {
			this.prefixAllKeeper = prefixAllKeeper;
		}
	}

	/**
	 * Provides an 'random' id (not true, but non-repetitive, which gives some warranty that you'll not get the trouble)
	 */
	private _randomId() { // at least it's non-repetitive
		return Date.now().toString(16) + randomString(5);
	}

	/**
	 * Goes trought the units and provides overall statistic if there's any units with default parsing and prefix check
	 * These values will be used in a flow to perform pre-parsing and pre-check and return to required units without any wait
	 * This can optimize flow execution time as because we're not going to parse once again and check the same value
	 */
	private _optimizeCheck() {
		this._anyWith = {
			defaultParsing: false,
			prefixCheck: false
		};

		for(const handler of this._flowUnits) {
			if(typeof handler.parser === "boolean" && handler.parser) {
				this._anyWith.defaultParsing = true;
			}
			if(typeof handler.checkPrefix === "boolean" && handler.checkPrefix) {
				this._anyWith.prefixCheck = true;
			}
			if(this._anyWith.defaultParsing && this._anyWith.prefixCheck) {
				break;
			}
		}
	}

	private _normalizeTimeout(type: "check" | "handler", value: number) {
		const val = Math.max(Math.min(value, type === "check" ? CHECK_MAXTIMEOUT : HANDLER_MAXTIMEOUT), -1);
		return val === 0 ? -1 : val; // kinda hacky
	}

	/**
	 * Watches for any new messages and once some message arrieves follows (or not if desired) the flow of checks and calls
	 * @param {Handler} handler Command handler
	 * @param {CheckArgument} check Command checking function
	 * @param {IWatcherCreationOptions} options Options for watcher
	 */
	public watchForMessages(handler: Handler, check: CheckArgument, options: IWatcherCreationOptions = {
		customParser: false,
		followsTheFlow: true,
		checkPrefix: false,
		timeoutCheck: this._timings.timeoutCheck,
		timeoutHandler: this._timings.timeoutHandler
	}): Readonly<IPublicFlowUnit> {
		const id = this._randomId();

		this._flowUnits.push({
			_id: id,
			handler,
			check,
			parser: options.customParser,
			followsTheFlow: typeof options.followsTheFlow !== "boolean" ? true : options.followsTheFlow,
			checkPrefix: options.checkPrefix,
			timeoutCheck: typeof options.timeoutCheck === "boolean" ? (!options.timeoutCheck ? -1 : this._timings.timeoutCheck) : (typeof options.timeoutCheck === "number" ? options.timeoutCheck : this._timings.timeoutCheck),
			timeoutHandler: typeof options.timeoutHandler === "boolean" ? (!options.timeoutHandler ? -1 : this._timings.timeoutHandler) : (typeof options.timeoutHandler === "number" ? options.timeoutHandler : this._timings.timeoutHandler)
		});

		this._optimizeCheck();

		return Object.freeze({
			id, unhandle: () => {
				const index = this._flowUnits.findIndex((handler) => handler._id === id);
				if(index === -1) { return false; }
				this._flowUnits.splice(index, 1);
				return true;
			}
		});
	}

	public async _startOnMessageFlow(msg: Message) {
		const flowUnits = this._flowUnits;
		if(!flowUnits || flowUnits.length === 0) { return; }

		// optimizing future results
		const simpleParserResult = this._anyWith.defaultParsing ? simpleCmdParse(msg.content) : undefined;
		const prefix = this._anyWith.prefixCheck && (this.prefixAllKeeper && this.prefixAllKeeper.state === ModuleLoadState.Initialized && this.prefixAllKeeper.base) ? this.prefixAllKeeper.base.checkPrefix(msg) : undefined;

		const execStart = Date.now();
		for(const flowUnit of flowUnits) {
			let _shouldBreak = false;
			const unitExecution = (async () => {
				// parser -> check -> handler
				if(flowUnit.checkPrefix && !prefix) { return; }

				const parserResult = typeof flowUnit.parser !== "undefined" && flowUnit.parser !== null ? (typeof flowUnit.parser === "function" ? await flowUnit.parser(msg) : (flowUnit.parser === true) ? simpleParserResult : undefined) : undefined;

				const ctx = Object.freeze({
					message: msg,
					parsed: parserResult
				});

				let _checkErr: PossibleError;
				const checkResult = (async () => {
					try {
						const timeoutVoid = (async () => {
							const normalizedTimeout = this._normalizeTimeout("check", flowUnit.timeoutCheck);
							if(normalizedTimeout === 1) { return; }
							await sleep(normalizedTimeout);
							throw new Error(`\`check\` execution of unit#${flowUnit._id} has timed out after ${(Date.now() - executionStart)}ms`);
						});

						const executionStart = Date.now();
						return await Promise.race([
							flowUnit.check(ctx),
							timeoutVoid
						]);
					} catch(err) {
						_checkErr = err;
						return undefined;
					}
				})();

				if(_checkErr) {
					this.log("warn", `The flow for message '${msg.id}' has found error while running check of unit#${flowUnit._id}`, _checkErr);
					return;
				}

				if(typeof checkResult !== "boolean") {
					this.log("warn", `The check of the flow unit#${flowUnit._id} has returned invalid value`, checkResult);
					return;
				} else if(!checkResult) { return; }

				let _handlerErr: PossibleError;
				const handlerResult = await (async () => {
					try {
						_handlerErr = undefined;
						const executionStart = Date.now();
						return await Promise.race([
							flowUnit.handler(ctx),
							(async () => {
								await sleep(this._timings.timeoutHandler);
								throw new Error(`\`handler\` execution of unit#${flowUnit._id} has timed out after ${(Date.now() - executionStart)}ms`);
							})
						]);
					} catch(err) {
						_handlerErr = err;
						return undefined;
					}
				});

				if(_handlerErr) {
					this.log("warn", `The flow for message '${msg.id}' has found error while running handler of unit#${flowUnit._id}`, _handlerErr);
					return;
				}

				if(Array.isArray(handlerResult) && handlerResult.length > 1 && handlerResult[0] === "flow") {
					switch(<FlowControlArgument>handlerResult[1]) {
						case FlowControlArgument.BREAK: {
							if(!flowUnit.followsTheFlow) {
								this.log("warn", `Unit#${flowUnit._id}'s handler requested to break the flow, but unit doesn't follow the flow. This argument has no sense to return. Consider removing this argument or make unit to follow the flow by passing special argument once creation. Skipped.`);
								break;
							}
							_shouldBreak = true;
						} break;
						case FlowControlArgument.RECALL_AFTER: {
							if(flowUnit.followsTheFlow) {
								await sleep(handlerResult[2]);
								await handlerResult();
								break;
							}
							setTimeout(() => {
								handlerResult();
							}, handlerResult[2]);
						} break;
						case FlowControlArgument.WAIT: {
							if(!flowUnit.followsTheFlow) {
								this.log("warn", `Unit#${flowUnit._id}'s handler requested to wait before continue the flow execution, but unit doesn't follow the flow. This argument has no sense to return. Consider removing this argument or make unit to follow the flow by passing special argument once creation. Skipped.`);
								break;
							}
							await sleep(handlerResult[2]);
						} break;
					}
				}
			})();

			if(flowUnit.followsTheFlow) {
				await unitExecution;
				if(_shouldBreak) { break; }
			}
		}

		this.log("info", `Flow exection complete, took ${(Date.now() - execStart)}ms`);
	}

	async unload() {
		$discordBot.removeListener("message", this._messageHandler);
		return false;
	}
}

interface IFlowUnit {
	check: CheckArgument;
	handler: Handler;
	followsTheFlow: boolean;
	checkPrefix?: boolean;
	parser?: ParseCommandArgument;
	timeoutCheck: number;
	timeoutHandler: number;
	_id: string;
}

export interface IPublicFlowUnit {
	unhandle(): boolean;
	id: string;
}

export interface IWatcherCreationOptions {
	/**
	 * Should unit use default parser or it has its own.
	 * Set to `true` to use default parser, pass parser function which returns {ISimpleCmdParseResult} to parse 
	 */
	customParser?: ParseCommandArgument;
	/**
	 * Does unit follows the flow.
	 * This means, should flow stop while executing this unit's function or not.
	 * Be aware that disabling flow following removes possibilities to control it (break, pause).
	 */
	followsTheFlow?: boolean;
	/**
	 * Should do 
	 */
	checkPrefix?: boolean;
	timeoutCheck?: boolean | number;
	timeoutHandler?: boolean | number;
}

export interface IMessageFlowContext {
	/**
	 * The message bot has just received and that passed the check
	 */
	message: Message;
	/**
	 * Result of the `parseCommand`.
	 * If it was set to `true`, then returns result of simple calling `simpleCmdParse` from `utils:text`.
	 * If `parseCommand` was set to `false` - it'll be null.
	 */
	parsed?: ISimpleCmdParseResult;
	/**
	 * The prefix of the message
	 * This will be undefined if your `prefixCheck` is set to `false`
	 */
	prefix?: string;
}

/**
 * Argument of command parsing.
 * You can pass `false` if you want to skip any command parsing.
 * Pass custom command parsing function or, set to `true` to call `simpleCmdParse` from `utils:text`.
 */
export type ParseCommandArgument = ((msg: Message) => Promise<ISimpleCmdParseResult>) | boolean;
/**
 * Argument of command checking.
 * Calls the functions and awaits for it's result (`true`/`false`).
 */
export type CheckArgument = ((ctx: IMessageFlowContext) => Promise<boolean> | boolean);
/**
 * If the check passed. Calls this function, if it returns Promise and `followTheFlow` set to `true`, then waits until Promise resolves.
 * Be aware! Promise should resolve in set timeout, this can be configured by option `flowTimings.handlerTimeout`, by default this value is set to constant `HANDLER_TIMEOUT` which you can get by improrting from this file. If promise will not resolve in set timeout, the flow continues.
 * Be also aware that you can break flow if you need to: if promise resolves with {FlowControl}, then checks the argument and does required stuff with Flow.
 */
export type Handler = ((ctx: IMessageFlowContext) => Promise<any>);
/**
 * Possible Promise resolved result of the {Handler}.
 */
export type FlowControl = ["flow", FlowControlArgument, any | undefined];

type PossibleError = Error | undefined;

/**
 * Arguments of the {FlowControl}
 */
export enum FlowControlArgument {
	/**
	 * Breaks the flow and skips all futher callings and checks
	 */
	BREAK = 1,
	/**
	 * Waits the select time and then continues flow execution
	 */
	WAIT = 2,
	/**
	 * Calls the handler that just returned this {FlowControlArgument} after selected period
	 */
	RECALL_AFTER = 3
}

module.exports = MessagesFlows;
